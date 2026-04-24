// ============================================================================
// 🎉 festividades.ts — Catálogo de fiestas nacionales/locales relevantes
// para un restaurante japonés en Mallorca. Usado por el Dashboard para
// avisar con antelación y sugerir posts/historias de marketing.
// ============================================================================

export type FestividadTipo = 'fiesta_nacional' | 'fiesta_local' | 'comercial' | 'cultural_japones';

export interface Festividad {
  id: string;
  nombre: string;
  emoji: string;
  mes: number;              // 1-12
  dia: number;              // 1-31
  tipo: FestividadTipo;
  relevancia: 1 | 2 | 3;    // 3 = clave para Arume
  sugerencia: string;       // Idea para el post
  hashtags?: string[];
}

// Catálogo fijo por fecha. Las que son variables (Semana Santa, Día de la Madre...)
// se calculan aparte más abajo.
export const FESTIVIDADES: Festividad[] = [
  // ENERO
  { id: 'año-nuevo',       nombre: 'Año Nuevo',          emoji: '🎆', mes: 1,  dia: 1,  tipo: 'fiesta_nacional', relevancia: 2,
    sugerencia: 'Brinda con sake para empezar el año con propósito.',
    hashtags: ['#AñoNuevo', '#SakeBar', '#ArumeMallorca'] },
  { id: 'reyes',           nombre: 'Reyes Magos',        emoji: '🎁', mes: 1,  dia: 6,  tipo: 'fiesta_nacional', relevancia: 2,
    sugerencia: 'Los regalos más deliciosos: vales regalo de Arume, menús degustación, sake premium.',
    hashtags: ['#DiaReyes', '#Regalo', '#ArumeSakeBar'] },
  { id: 'san-sebastian',   nombre: 'San Sebastián',      emoji: '🔥', mes: 1,  dia: 20, tipo: 'fiesta_local',    relevancia: 3,
    sugerencia: 'Palma celebra a su patrón — abrimos con menú especial y sake caliente.',
    hashtags: ['#SanSebastian', '#Palma', '#FestaPatronal'] },

  // FEBRERO
  { id: 'san-valentin',    nombre: 'San Valentín',       emoji: '❤️', mes: 2,  dia: 14, tipo: 'comercial',       relevancia: 3,
    sugerencia: 'Menú romántico para dos con omakase + sake especial. Reserva ya.',
    hashtags: ['#SanValentin', '#CenaRomantica', '#Mallorca'] },

  // MARZO
  { id: 'dia-mujer',       nombre: 'Día de la Mujer',    emoji: '🌸', mes: 3,  dia: 8,  tipo: 'cultural_japones', relevancia: 2,
    sugerencia: 'Brindamos con sake rosé por todas. Mesa de mujeres con 10% descuento.',
    hashtags: ['#8M', '#DiaMujer', '#ArumeMallorca'] },
  { id: 'dia-padre',       nombre: 'Día del Padre',      emoji: '🍶', mes: 3,  dia: 19, tipo: 'comercial',       relevancia: 3,
    sugerencia: 'Regala experiencia: menú padre + hijo con clase de sake incluida.',
    hashtags: ['#DiaPadre', '#Regalo', '#Padre'] },

  // ABRIL
  { id: 'sant-jordi',      nombre: 'Sant Jordi',         emoji: '🌹', mes: 4,  dia: 23, tipo: 'cultural_japones', relevancia: 3,
    sugerencia: 'Una rosa y un libro con cada menú. Edición limitada: maridaje sake + haiku.',
    hashtags: ['#SantJordi', '#DiaDelLibro', '#DiaRosa'] },

  // MAYO
  { id: 'dia-trabajo',     nombre: 'Día del Trabajo',    emoji: '🛠️', mes: 5,  dia: 1,  tipo: 'fiesta_nacional', relevancia: 1,
    sugerencia: 'Abrimos al mediodía — menú express para descansar del descanso.',
    hashtags: ['#1Mayo', '#DiaTrabajo'] },

  // JUNIO
  { id: 'san-juan',        nombre: 'Sant Joan',          emoji: '🔥', mes: 6,  dia: 23, tipo: 'fiesta_nacional', relevancia: 3,
    sugerencia: 'Terraza llena, hogueras en la playa. Menú especial brasa + sake helado.',
    hashtags: ['#SantJoan', '#NoitDeSanJoan', '#Mallorca'] },

  // JULIO
  { id: 'virgen-carmen',   nombre: 'Virgen del Carmen',  emoji: '⛵', mes: 7,  dia: 16, tipo: 'fiesta_local',    relevancia: 2,
    sugerencia: 'Patrona del mar — menú especial pescado fresco y sake Junmai.',
    hashtags: ['#VirgenCarmen', '#Mallorca', '#PescadoFresco'] },

  // AGOSTO
  { id: 'asuncion',        nombre: 'La Asunción',        emoji: '☀️', mes: 8,  dia: 15, tipo: 'fiesta_nacional', relevancia: 1,
    sugerencia: 'Verano en plenitud. Reservas para cena al fresco.',
    hashtags: ['#Verano', '#Mallorca'] },

  // OCTUBRE
  { id: 'dia-hispanidad',  nombre: 'Día de la Hispanidad', emoji: '🇪🇸', mes: 10, dia: 12, tipo: 'fiesta_nacional', relevancia: 1,
    sugerencia: 'Fusión Oriente-Occidente — menú especial puente.',
    hashtags: ['#Hispanidad', '#12Octubre'] },
  { id: 'halloween',       nombre: 'Halloween',          emoji: '🎃', mes: 10, dia: 31, tipo: 'comercial',       relevancia: 2,
    sugerencia: 'Menú temático: sushi negro, tentáculos, sake oscuro. Ven disfrazad@.',
    hashtags: ['#Halloween', '#Sushi', '#ArumeHalloween'] },

  // NOVIEMBRE
  { id: 'todos-santos',    nombre: 'Todos los Santos',   emoji: '🕯️', mes: 11, dia: 1,  tipo: 'fiesta_nacional', relevancia: 1,
    sugerencia: 'Puente largo, reservas disponibles.',
    hashtags: ['#TodosSantos'] },
  { id: 'black-friday',    nombre: 'Black Friday',       emoji: '🏷️', mes: 11, dia: 28, tipo: 'comercial',       relevancia: 3,
    sugerencia: 'Tienda: 15% descuento en sake premium. Menús regalo al mejor precio del año.',
    hashtags: ['#BlackFriday', '#SakeMallorca'] },

  // DICIEMBRE
  { id: 'constitucion',    nombre: 'Constitución',       emoji: '🏛️', mes: 12, dia: 6,  tipo: 'fiesta_nacional', relevancia: 1,
    sugerencia: 'Puente de diciembre, menú a la carta.',
    hashtags: ['#Constitucion'] },
  { id: 'inmaculada',      nombre: 'La Inmaculada',      emoji: '✨', mes: 12, dia: 8,  tipo: 'fiesta_nacional', relevancia: 1,
    sugerencia: 'Preparando la Navidad — reservas abiertas.',
    hashtags: ['#Inmaculada'] },
  { id: 'nochebuena',      nombre: 'Nochebuena',         emoji: '🎄', mes: 12, dia: 24, tipo: 'fiesta_nacional', relevancia: 3,
    sugerencia: 'Cenamos en casa el 24. Reserva menú familiar para llevar.',
    hashtags: ['#Nochebuena', '#Navidad', '#MenuParaLlevar'] },
  { id: 'navidad',         nombre: 'Navidad',            emoji: '🎄', mes: 12, dia: 25, tipo: 'fiesta_nacional', relevancia: 3,
    sugerencia: 'Feliz Navidad — kanpai 🍶 desde Arume.',
    hashtags: ['#Navidad', '#FelizNavidad'] },
  { id: 'nochevieja',      nombre: 'Nochevieja',         emoji: '🥂', mes: 12, dia: 31, tipo: 'fiesta_nacional', relevancia: 3,
    sugerencia: 'Cena de fin de año: menú degustación + 12 uvas + copa de sake espumoso.',
    hashtags: ['#Nochevieja', '#FinDeAño', '#ArumeNyE'] },
];

// Día de la Madre en España (primer domingo de mayo)
function diaDeLaMadre(year: number): Festividad {
  const mayo1 = new Date(year, 4, 1);
  const offset = (7 - mayo1.getDay()) % 7; // 0 si ya es domingo
  const dia = 1 + offset;
  return {
    id: 'dia-madre',
    nombre: 'Día de la Madre',
    emoji: '💐',
    mes: 5,
    dia,
    tipo: 'comercial',
    relevancia: 3,
    sugerencia: 'Brunch especial para mamás con un sake floral de regalo.',
    hashtags: ['#DiaMadre', '#Mama', '#ArumeBrunch'],
  };
}

/**
 * Devuelve las festividades ordenadas por proximidad (más cercana primero)
 * DESDE hoy hasta los próximos 60 días. Incluye calculadas (Día de la Madre).
 */
export function proximasFestividades(dentroDe: number = 60): Array<Festividad & { diasRestantes: number; fechaCompleta: string }> {
  const hoy = new Date();
  const hoyTs = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
  const currentYear = hoy.getFullYear();

  const todas = [
    ...FESTIVIDADES,
    diaDeLaMadre(currentYear),
    diaDeLaMadre(currentYear + 1), // por si estamos en diciembre
  ];

  const resultado: Array<Festividad & { diasRestantes: number; fechaCompleta: string }> = [];

  for (const f of todas) {
    // Genera instancia este año y el siguiente
    for (const yearOffset of [0, 1]) {
      const year = currentYear + yearOffset;
      // Si es Día de la Madre calculado, ya tiene el día para ese año
      if (f.id === 'dia-madre') {
        const dm = diaDeLaMadre(year);
        if (f.dia !== dm.dia) continue; // solo procesar la instancia correcta
      }
      const fechaEvento = new Date(year, f.mes - 1, f.dia);
      const diff = Math.ceil((fechaEvento.getTime() - hoyTs) / 86_400_000);
      if (diff < 0 || diff > dentroDe) continue;
      resultado.push({
        ...f,
        diasRestantes: diff,
        fechaCompleta: `${year}-${String(f.mes).padStart(2,'0')}-${String(f.dia).padStart(2,'0')}`,
      });
    }
  }

  return resultado.sort((a, b) => a.diasRestantes - b.diasRestantes);
}
