export type RegionElSalvador = 'Occidental' | 'Central' | 'Paracentral' | 'Oriental';

export interface DepartamentoGeo {
  id: string;
  nombre: string;
  nombreNormalizado: string; // Para matchear sin tildes ni mayúsculas
  region: RegionElSalvador;
  cabecera: string;
  path: string;
  labelX: number;
  labelY: number;
}

// 14 Departamentos de la República de El Salvador con coordenadas vectoriales SVG (viewBox 0 0 960 520)
export const DEPARTAMENTOS_EL_SALVADOR: DepartamentoGeo[] = [
  // --- ZONA OCCIDENTAL ---
  {
    id: 'ahuachapan',
    nombre: 'Ahuachapán',
    nombreNormalizado: 'ahuachapan',
    region: 'Occidental',
    cabecera: 'Ahuachapán',
    // Frontera occidental con Guatemala, costa norte y límites con Santa Ana y Sonsonate
    path: 'M 50,210 L 95,145 L 140,135 L 165,185 L 155,255 L 135,290 L 105,325 L 65,300 L 45,260 Z',
    labelX: 105,
    labelY: 225,
  },
  {
    id: 'santa-ana',
    nombre: 'Santa Ana',
    nombreNormalizado: 'santa ana',
    region: 'Occidental',
    cabecera: 'Santa Ana',
    // Limita con Guatemala al NO, Chalatenango al NE, Ahuachapán al O, Sonsonate y La Libertad al S
    path: 'M 140,135 L 180,95 L 235,70 L 270,95 L 285,150 L 265,215 L 230,265 L 185,275 L 165,185 Z',
    labelX: 215,
    labelY: 175,
  },
  {
    id: 'sonsonate',
    nombre: 'Sonsonate',
    nombreNormalizado: 'sonsonate',
    region: 'Occidental',
    cabecera: 'Sonsonate',
    // Costa pacífica suroccidental (Acajutla), limita con Ahuachapán, Santa Ana y La Libertad
    path: 'M 105,325 L 135,290 L 155,255 L 185,275 L 230,265 L 265,320 L 250,380 L 195,420 L 145,395 L 115,360 Z',
    labelX: 185,
    labelY: 340,
  },

  // --- ZONA CENTRAL ---
  {
    id: 'chalatenango',
    nombre: 'Chalatenango',
    nombreNormalizado: 'chalatenango',
    region: 'Central',
    cabecera: 'Chalatenango',
    // Franja norte montañosa en la frontera con Honduras (El Pital)
    path: 'M 270,95 L 340,65 L 430,60 L 510,95 L 535,140 L 485,175 L 420,185 L 350,175 L 285,150 Z',
    labelX: 400,
    labelY: 125,
  },
  {
    id: 'la-libertad',
    nombre: 'La Libertad',
    nombreNormalizado: 'la libertad',
    region: 'Central',
    cabecera: 'Santa Tecla',
    // Zona central-costera (Surf City), rodea San Salvador por el oeste y sur
    path: 'M 230,265 L 265,215 L 320,205 L 360,225 L 375,270 L 355,340 L 375,410 L 330,440 L 275,425 L 250,380 L 265,320 Z',
    labelX: 305,
    labelY: 315,
  },
  {
    id: 'san-salvador',
    nombre: 'San Salvador',
    nombreNormalizado: 'san salvador',
    region: 'Central',
    cabecera: 'San Salvador',
    // Núcleo metropolitano y económico
    path: 'M 360,225 L 405,215 L 435,240 L 445,285 L 415,325 L 375,320 L 365,275 Z',
    labelX: 400,
    labelY: 270,
  },
  {
    id: 'cuscatlan',
    nombre: 'Cuscatlán',
    nombreNormalizado: 'cuscatlan',
    region: 'Central',
    cabecera: 'Cojutepeque',
    // Departamento al este de San Salvador y lago de Ilopango
    path: 'M 405,215 L 455,195 L 495,215 L 485,275 L 445,285 L 435,240 Z',
    labelX: 460,
    labelY: 245,
  },

  // --- ZONA PARACENTRAL ---
  {
    id: 'la-paz',
    nombre: 'La Paz',
    nombreNormalizado: 'la paz',
    region: 'Paracentral',
    cabecera: 'Zacatecoluca',
    // Costa paracentral, Aeropuerto Internacional El Salvador (Monseñor Romero)
    path: 'M 375,320 L 415,325 L 450,315 L 485,345 L 505,405 L 480,455 L 420,465 L 375,410 L 355,340 Z',
    labelX: 435,
    labelY: 390,
  },
  {
    id: 'cabanas',
    nombre: 'Cabañas',
    nombreNormalizado: 'cabanas',
    region: 'Paracentral',
    cabecera: 'Sensuntepeque',
    // Al norte del río Lempa y embalse del Cerrón Grande
    path: 'M 485,175 L 535,140 L 595,160 L 610,215 L 565,255 L 495,215 L 455,195 Z',
    labelX: 545,
    labelY: 205,
  },
  {
    id: 'san-vicente',
    nombre: 'San Vicente',
    nombreNormalizado: 'san vicente',
    region: 'Paracentral',
    cabecera: 'San Vicente',
    // Volcán de San Vicente (Chinchontepec) y valle de Jiboa
    path: 'M 485,275 L 565,255 L 590,305 L 580,380 L 525,415 L 505,405 L 485,345 L 450,315 Z',
    labelX: 535,
    labelY: 335,
  },

  // --- ZONA ORIENTAL ---
  {
    id: 'usulutan',
    nombre: 'Usulután',
    nombreNormalizado: 'usulutan',
    region: 'Oriental',
    cabecera: 'Usulután',
    // Costa oriental, Bahía de Jiquilisco
    path: 'M 580,380 L 590,305 L 655,315 L 705,355 L 710,430 L 675,475 L 615,480 L 555,445 L 525,415 Z',
    labelX: 635,
    labelY: 410,
  },
  {
    id: 'san-miguel',
    nombre: 'San Miguel',
    nombreNormalizado: 'san miguel',
    region: 'Oriental',
    cabecera: 'San Miguel',
    // Gran eje comercial y agrícola del oriente, volcán Chaparrastique
    path: 'M 610,215 L 675,185 L 720,205 L 735,285 L 705,355 L 655,315 L 590,305 L 565,255 Z',
    labelX: 660,
    labelY: 265,
  },
  {
    id: 'morazan',
    nombre: 'Morazán',
    nombreNormalizado: 'morazan',
    region: 'Oriental',
    cabecera: 'San Francisco Gotera',
    // Cordillera norteña oriental, límite con Honduras
    path: 'M 675,185 L 740,135 L 815,155 L 825,230 L 765,260 L 735,285 L 720,205 Z',
    labelX: 765,
    labelY: 200,
  },
  {
    id: 'la-union',
    nombre: 'La Unión',
    nombreNormalizado: 'la union',
    region: 'Oriental',
    cabecera: 'La Unión',
    // Extremo oriental de El Salvador, Golfo de Fonseca e islas
    path: 'M 765,260 L 825,230 L 885,255 L 910,320 L 890,405 L 845,465 L 790,460 L 745,435 L 710,430 L 705,355 L 735,285 Z',
    labelX: 825,
    labelY: 345,
  },
];

// Función utilitaria para normalizar texto de departamento proveniente de WhatsApp o formularios
export function normalizarDepartamento(deptoInput?: string | null): string {
  if (!deptoInput) return 'San Salvador';
  const clean = deptoInput
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // Buscar coincidencia directa
  const encontrado = DEPARTAMENTOS_EL_SALVADOR.find(d => 
    clean.includes(d.nombreNormalizado) || d.nombreNormalizado.includes(clean)
  );

  return encontrado ? encontrado.nombre : 'San Salvador';
}

export const REGIONES_CONFIG: Record<RegionElSalvador, { nombre: string; color: string; bg: string }> = {
  Occidental: { nombre: 'Zona Occidental', color: 'text-amber-500', bg: 'bg-amber-500/10' },
  Central: { nombre: 'Zona Central', color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
  Paracentral: { nombre: 'Zona Paracentral', color: 'text-sky-500', bg: 'bg-sky-500/10' },
  Oriental: { nombre: 'Zona Oriental', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
};
