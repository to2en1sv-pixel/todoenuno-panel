export type RegionElSalvador = 'Occidental' | 'Central' | 'Paracentral' | 'Oriental';

export interface DepartamentoGeo {
  id: string;
  nombre: string;
  nombreNormalizado: string;
  region: RegionElSalvador;
  cabecera: string;
  path: string;
  labelX: number;
  labelY: number;
  municipios: string[];
}

// Catálogo de Municipios / Distritos Clave por Departamento en El Salvador
export const MUNICIPIOS_POR_DEPTO: Record<string, string[]> = {
  'San Salvador': [
    'San Salvador', 'Soyapango', 'Ilopango', 'Apopa', 'Mejicanos', 
    'Ciudad Delgado', 'Cuscatancingo', 'San Marcos', 'Ayutuxtepeque', 
    'San Martín', 'Tonacatepeque', 'Nejapa', 'Santo Tomás', 'Panchimalco', 'Aguilares'
  ],
  'La Libertad': [
    'Santa Tecla', 'Antiguo Cuscatlán', 'Colón (Lourdes)', 'Zaragoza', 
    'San Juan Opico', 'Quezaltepeque', 'La Libertad (Puerto)', 'Ciudad Arce', 
    'Nuevo Cuscatlán', 'Huizúcar', 'San Pablo Tacachico'
  ],
  'Santa Ana': [
    'Santa Ana', 'Chalchuapa', 'Metapán', 'Coatepeque', 
    'Texistepeque', 'Candelaria de la Frontera', 'El Congo'
  ],
  'San Miguel': [
    'San Miguel', 'Chinameca', 'Ciudad Barrios', 'Moncagua', 
    'Sesori', 'Uluazapa', 'Chirilagua', 'Lolotique'
  ],
  'Sonsonate': [
    'Sonsonate', 'Acajutla', 'Izalco', 'Nahuizalco', 
    'Sonzacate', 'Armenia', 'Juayúa', 'Salcoatitán'
  ],
  'Usulután': [
    'Usulután', 'Jiquilisco', 'Santiago de María', 'Puerto El Triunfo', 
    'Berlín', 'Jucuapa', 'Santa Elena', 'Ozatlán'
  ],
  'Ahuachapán': [
    'Ahuachapán', 'Atiquizaya', 'Apaneca', 'Concepción de Ataco', 
    'Guaymango', 'San Francisco Menéndez (Cara Sucia)', 'Tacuba'
  ],
  'La Paz': [
    'Zacatecoluca', 'Olocuilta', 'San Luis Talpa (Aeropuerto)', 
    'Santiago Nonualco', 'San Pedro Masahuat', 'San Juan Nonualco', 'San Luis La Herradura'
  ],
  'Cuscatlán': [
    'Cojutepeque', 'San Pedro Perulapán', 'Suchitoto', 
    'San Bartolomé Perulapía', 'San Rafael Cedros', 'Candelaria'
  ],
  'Chalatenango': [
    'Chalatenango', 'Nueva Concepción', 'La Palma', 'Tejutla', 
    'Agua Caliente', 'Dulce Nombre de María', 'San Ignacio', 'La Reina'
  ],
  'Morazán': [
    'San Francisco Gotera', 'Perquín', 'Jocoro', 'Corinto', 
    'Osicala', 'Guatajiagua', 'Cacaopera'
  ],
  'San Vicente': [
    'San Vicente', 'Tecoluca', 'Apastepeque', 'San Sebastián', 
    'Guadalupe', 'Santo Domingo'
  ],
  'Cabañas': [
    'Sensuntepeque', 'Ilobasco', 'Victoria', 'Dolores', 
    'Guacotecti', 'San Isidro'
  ],
  'La Unión': [
    'La Unión', 'Santa Rosa de Lima', 'Conchagua', 'Pasaquina', 
    'Intipucá', 'Anamorós', 'San Alejo'
  ]
};

// 14 Departamentos de El Salvador con curvas vectoriales precisas (viewBox 0 0 960 520)
export const DEPARTAMENTOS_EL_SALVADOR: DepartamentoGeo[] = [
  // --- ZONA OCCIDENTAL ---
  {
    id: 'ahuachapan',
    nombre: 'Ahuachapán',
    nombreNormalizado: 'ahuachapan',
    region: 'Occidental',
    cabecera: 'Ahuachapán',
    path: 'M 40,240 C 50,195 80,155 115,130 C 135,145 150,170 160,200 C 150,235 138,275 125,320 C 105,335 80,335 60,310 C 42,280 38,260 40,240 Z',
    labelX: 95,
    labelY: 235,
    municipios: MUNICIPIOS_POR_DEPTO['Ahuachapán']
  },
  {
    id: 'santa-ana',
    nombre: 'Santa Ana',
    nombreNormalizado: 'santa ana',
    region: 'Occidental',
    cabecera: 'Santa Ana',
    path: 'M 115,130 C 150,95 190,65 240,60 C 265,85 285,125 290,165 C 275,200 255,230 225,250 C 190,240 170,220 160,200 C 150,170 135,145 115,130 Z',
    labelX: 205,
    labelY: 155,
    municipios: MUNICIPIOS_POR_DEPTO['Santa Ana']
  },
  {
    id: 'sonsonate',
    nombre: 'Sonsonate',
    nombreNormalizado: 'sonsonate',
    region: 'Occidental',
    cabecera: 'Sonsonate',
    path: 'M 125,320 C 138,275 150,235 160,200 C 170,220 190,240 225,250 C 235,285 245,330 255,370 C 230,405 195,420 160,405 C 135,385 120,355 125,320 Z',
    labelX: 180,
    labelY: 320,
    municipios: MUNICIPIOS_POR_DEPTO['Sonsonate']
  },

  // --- ZONA CENTRAL ---
  {
    id: 'chalatenango',
    nombre: 'Chalatenango',
    nombreNormalizado: 'chalatenango',
    region: 'Central',
    cabecera: 'Chalatenango',
    path: 'M 240,60 C 310,50 385,50 460,65 C 505,80 535,115 545,150 C 500,165 450,170 405,170 C 350,170 310,160 290,165 C 285,125 265,85 240,60 Z',
    labelX: 395,
    labelY: 115,
    municipios: MUNICIPIOS_POR_DEPTO['Chalatenango']
  },
  {
    id: 'la-libertad',
    nombre: 'La Libertad',
    nombreNormalizado: 'la libertad',
    region: 'Central',
    cabecera: 'Santa Tecla',
    path: 'M 225,250 C 255,230 275,200 290,165 C 310,160 335,170 355,190 C 350,230 350,270 355,310 C 365,355 365,400 350,435 C 315,445 275,420 255,370 C 245,330 235,285 225,250 Z',
    labelX: 295,
    labelY: 300,
    municipios: MUNICIPIOS_POR_DEPTO['La Libertad']
  },
  {
    id: 'san-salvador',
    nombre: 'San Salvador',
    nombreNormalizado: 'san salvador',
    region: 'Central',
    cabecera: 'San Salvador',
    path: 'M 355,190 C 375,180 405,185 425,205 C 430,235 435,265 425,295 C 400,320 375,325 355,310 C 350,270 350,230 355,190 Z',
    labelX: 390,
    labelY: 250,
    municipios: MUNICIPIOS_POR_DEPTO['San Salvador']
  },
  {
    id: 'cuscatlan',
    nombre: 'Cuscatlán',
    nombreNormalizado: 'cuscatlan',
    region: 'Central',
    cabecera: 'Cojutepeque',
    path: 'M 425,205 C 445,190 475,190 495,205 C 500,240 495,275 480,295 C 455,305 435,305 425,295 C 435,265 430,235 425,205 Z',
    labelX: 460,
    labelY: 250,
    municipios: MUNICIPIOS_POR_DEPTO['Cuscatlán']
  },

  // --- ZONA PARACENTRAL ---
  {
    id: 'la-paz',
    nombre: 'La Paz',
    nombreNormalizado: 'la paz',
    region: 'Paracentral',
    cabecera: 'Zacatecoluca',
    path: 'M 355,310 C 375,325 400,320 425,295 C 455,305 470,320 480,345 C 485,390 480,430 460,460 C 410,470 370,460 350,435 C 365,400 365,355 355,310 Z',
    labelX: 415,
    labelY: 395,
    municipios: MUNICIPIOS_POR_DEPTO['La Paz']
  },
  {
    id: 'cabanas',
    nombre: 'Cabañas',
    nombreNormalizado: 'cabanas',
    region: 'Paracentral',
    cabecera: 'Sensuntepeque',
    path: 'M 405,170 C 450,170 500,165 545,150 C 580,160 610,185 620,215 C 595,245 565,255 530,250 C 500,240 475,190 445,190 C 425,185 415,175 405,170 Z',
    labelX: 530,
    labelY: 205,
    municipios: MUNICIPIOS_POR_DEPTO['Cabañas']
  },
  {
    id: 'san-vicente',
    nombre: 'San Vicente',
    nombreNormalizado: 'san vicente',
    region: 'Paracentral',
    cabecera: 'San Vicente',
    path: 'M 480,295 C 495,275 500,240 530,250 C 565,255 585,280 595,310 C 590,360 575,400 545,430 C 505,445 485,420 480,345 C 470,320 455,305 480,295 Z',
    labelX: 535,
    labelY: 345,
    municipios: MUNICIPIOS_POR_DEPTO['San Vicente']
  },

  // --- ZONA ORIENTAL ---
  {
    id: 'usulutan',
    nombre: 'Usulután',
    nombreNormalizado: 'usulutan',
    region: 'Oriental',
    cabecera: 'Usulután',
    path: 'M 545,430 C 575,400 590,360 595,310 C 630,315 670,325 700,350 C 705,395 700,440 680,470 C 630,480 580,470 545,430 Z',
    labelX: 625,
    labelY: 405,
    municipios: MUNICIPIOS_POR_DEPTO['Usulután']
  },
  {
    id: 'san-miguel',
    nombre: 'San Miguel',
    nombreNormalizado: 'san miguel',
    region: 'Oriental',
    cabecera: 'San Miguel',
    path: 'M 595,310 C 585,280 565,255 620,215 C 655,200 690,205 715,225 C 730,265 730,310 715,350 C 700,350 670,325 630,315 C 610,312 600,310 595,310 Z',
    labelX: 660,
    labelY: 280,
    municipios: MUNICIPIOS_POR_DEPTO['San Miguel']
  },
  {
    id: 'morazan',
    nombre: 'Morazán',
    nombreNormalizado: 'morazan',
    region: 'Oriental',
    cabecera: 'San Francisco Gotera',
    path: 'M 690,205 C 730,165 785,150 835,165 C 840,210 825,250 790,270 C 760,280 735,275 715,225 C 690,205 690,205 690,205 Z',
    labelX: 765,
    labelY: 215,
    municipios: MUNICIPIOS_POR_DEPTO['Morazán']
  },
  {
    id: 'la-union',
    nombre: 'La Unión',
    nombreNormalizado: 'la union',
    region: 'Oriental',
    cabecera: 'La Unión',
    path: 'M 715,350 C 730,310 730,265 790,270 C 825,250 840,210 835,165 C 875,190 905,235 915,285 C 920,340 895,395 860,435 C 805,455 745,435 700,440 C 705,395 700,350 715,350 Z',
    labelX: 825,
    labelY: 345,
    municipios: MUNICIPIOS_POR_DEPTO['La Unión']
  },
];

// Extrae el municipio / distrito más probable a partir del texto de dirección
export function extraerMunicipio(direccion?: string | null, deptoNombre?: string): string {
  if (!direccion) {
    const d = DEPARTAMENTOS_EL_SALVADOR.find(x => x.nombre === deptoNombre);
    return d ? `${d.cabecera} (Centro)` : 'Zona Urbana';
  }

  const dirLower = direccion.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Buscar en los municipios del departamento
  const municipiosDelDepto = deptoNombre ? (MUNICIPIOS_POR_DEPTO[deptoNombre] || []) : [];
  for (const m of municipiosDelDepto) {
    const mNorm = m.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\(.*\)/, '').trim();
    if (mNorm.length >= 4 && dirLower.includes(mNorm)) {
      return m;
    }
    // Casos comunes
    if (m.includes('Lourdes') && dirLower.includes('lourdes')) return 'Colón (Lourdes)';
    if (m.includes('Aeropuerto') && (dirLower.includes('aeropuerto') || dirLower.includes('comalapa'))) return 'San Luis Talpa (Aeropuerto)';
    if (m.includes('Cara Sucia') && dirLower.includes('cara sucia')) return 'San Francisco Menéndez (Cara Sucia)';
  }

  // Buscar globalmente
  for (const [dep, munis] of Object.entries(MUNICIPIOS_POR_DEPTO)) {
    for (const m of munis) {
      const mNorm = m.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\(.*\)/, '').trim();
      if (mNorm.length >= 5 && dirLower.includes(mNorm)) {
        return m;
      }
    }
  }

  const deptoObj = DEPARTAMENTOS_EL_SALVADOR.find(x => x.nombre === deptoNombre);
  return deptoObj ? `${deptoObj.cabecera} (Centro)` : 'Zona Urbana';
}

// Función utilitaria para normalizar texto de departamento
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
