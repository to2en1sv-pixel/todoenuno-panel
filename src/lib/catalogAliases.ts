/**
 * TODOENUNO OS — MOTOR DE ATRIBUCIÓN Y ALIAS DE CATÁLOGO
 * Interconecta: Catálogo de Productos <--> Pedidos (WhatsApp) <--> Rentabilidad & ROAS
 * 
 * Permite que órdenes con descripciones variadas ("3 pulseras magneticas", "pulsera magnetica negra", "Promo 2x1")
 * y distintos códigos de anuncio ("pulmag01", "pulseras-fb") se atribuyan al mismo Producto Maestro del Catálogo.
 */

export interface ProductAttribution {
  catalogo_sku: string;
  nombre?: string;
  aliases: string[];    // Textos libres usados en pedidos (ej. "3 pulseras magneticas", "PORTA BEBES GRIS")
  adCodes: string[];    // Códigos de campaña/anuncio (ej. "pulmag01", "portabebes01")
}

const STORAGE_KEY = 'todoenuno_catalog_attribution_v1';

/**
 * Normaliza un texto para comparaciones flexibles:
 * Convierte a minúsculas, elimina acentos/diacríticos y espacios múltiples.
 */
export function normalizeKey(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')       // Solo alfanuméricos
    .replace(/\s+/g, ' ')             // Espacios simples
    .trim();
}

/**
 * Mapeo semilla pre-cargado con base en los productos y anuncios reales de TODOENUNO OS
 */
const DEFAULT_ATTRIBUTION_SEED: Record<string, { aliases: string[]; adCodes: string[] }> = {
  'PORTA-BEBES': {
    aliases: ['porta bebes', 'porta bebes gris', 'porta bebe', 'portabebes', 'porta bebes ergonomico'],
    adCodes: ['portabebes', 'portabebes01', 'portabebe', 'porta-bebes']
  },
  'PULSERA-MAG': {
    aliases: ['pulseras magneticas', '3 pulseras magneticas', 'pulsera magnetica', 'pulseras de pareja', 'pulseras iman'],
    adCodes: ['pulmag01', 'pulmag', 'pulseras01', 'pulseras-fb']
  },
  'MINI-MASAJ': {
    aliases: ['mini masajeadores', 'promo 2 mini masajeadores', 'mini masajeador', 'masajeador ems', 'parche masajeador'],
    adCodes: ['masaj01', 'minimasaj', 'promo2masaj']
  },
  'BANCO-RETRACTIL': {
    aliases: ['bancoretractil', 'banco retractil', 'silla retractil', 'banco plegable'],
    adCodes: ['bancoretractil', 'banco01']
  },
  'ENCENDEDORES': {
    aliases: ['encendedores', 'encendedor usb', 'encendedor electrico', 'encendedor plasma'],
    adCodes: ['encendedor', 'encendedores', 'encendedor01']
  }
};

/**
 * Cargar el mapa de atribución desde localStorage fusionado con valores por defecto
 */
export function loadAttributionMap(): Record<string, { aliases: string[]; adCodes: string[] }> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveAttributionMap(DEFAULT_ATTRIBUTION_SEED);
      return { ...DEFAULT_ATTRIBUTION_SEED };
    }
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_ATTRIBUTION_SEED, ...parsed };
  } catch {
    return { ...DEFAULT_ATTRIBUTION_SEED };
  }
}

/**
 * Guardar el mapa de atribución en localStorage
 */
export function saveAttributionMap(map: Record<string, { aliases: string[]; adCodes: string[] }>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.error('Error guardando mapa de atribución:', err);
  }
}

/**
 * Resuelve el SKU del Catálogo al que pertenece una orden o gasto de publicidad
 */
export function resolveCatalogSku(
  rawSku: string | null | undefined,
  adCode: string | null | undefined,
  catalogoSku?: string | null | undefined,
  knownCatalogSkus: string[] = []
): string | null {
  // 1. Si ya tiene un catalogo_sku explícito
  if (catalogoSku && catalogoSku.trim()) {
    return catalogoSku.trim().toUpperCase();
  }

  const map = loadAttributionMap();
  const normRawSku = normalizeKey(rawSku);
  const normAdCode = normalizeKey(adCode);

  // 2. Coincidencia exacta con un SKU de catálogo conocido
  for (const cSku of knownCatalogSkus) {
    const normC = normalizeKey(cSku);
    if (normC === normRawSku || normC === normAdCode) {
      return cSku;
    }
  }

  // 3. Búsqueda en el mapa de atribución guardado
  for (const [masterSku, data] of Object.entries(map)) {
    const normMaster = normalizeKey(masterSku);
    if (normMaster === normRawSku || normMaster === normAdCode) {
      return masterSku;
    }

    // Coincidencia por alias de texto
    if (normRawSku && data.aliases) {
      for (const a of data.aliases) {
        const normA = normalizeKey(a);
        if (normA === normRawSku || (normA.length > 4 && (normRawSku.includes(normA) || normA.includes(normRawSku)))) {
          return masterSku;
        }
      }
    }

    // Coincidencia por código de anuncio
    if (normAdCode && data.adCodes) {
      for (const ac of data.adCodes) {
        const normAc = normalizeKey(ac);
        if (normAc === normAdCode || (normAc.length > 3 && (normAdCode.includes(normAc) || normAc.includes(normAdCode)))) {
          return masterSku;
        }
      }
    }
  }

  // 4. Heurística de substring sobre SKUs conocidos
  if (normRawSku && knownCatalogSkus.length > 0) {
    for (const cSku of knownCatalogSkus) {
      const normC = normalizeKey(cSku);
      if (normC.length > 4 && (normRawSku.includes(normC) || normC.includes(normRawSku))) {
        return cSku;
      }
    }
  }

  return null;
}

/**
 * Vincula un alias de texto (ej. "PORTA BEBES GRIS") a un producto de catálogo
 */
export function linkRawSkuToProduct(rawSku: string, targetCatalogSku: string): void {
  if (!rawSku || !targetCatalogSku) return;
  const map = loadAttributionMap();
  const cSku = targetCatalogSku.trim().toUpperCase();
  const normRaw = rawSku.trim();

  if (!map[cSku]) {
    map[cSku] = { aliases: [], adCodes: [] };
  }

  // Quitar de otros productos si estaba vinculado antes
  for (const [skuKey, data] of Object.entries(map)) {
    if (skuKey !== cSku && data.aliases) {
      data.aliases = data.aliases.filter(a => normalizeKey(a) !== normalizeKey(normRaw));
    }
  }

  if (!map[cSku].aliases.some(a => normalizeKey(a) === normalizeKey(normRaw))) {
    map[cSku].aliases.push(normRaw);
  }

  saveAttributionMap(map);
}

/**
 * Vincula un código de anuncio (ej. "pulmag01") a un producto de catálogo
 */
export function linkAdCodeToProduct(adCode: string, targetCatalogSku: string): void {
  if (!adCode || !targetCatalogSku) return;
  const map = loadAttributionMap();
  const cSku = targetCatalogSku.trim().toUpperCase();
  const normAd = adCode.trim();

  if (!map[cSku]) {
    map[cSku] = { aliases: [], adCodes: [] };
  }

  // Quitar de otros si estaba
  for (const [skuKey, data] of Object.entries(map)) {
    if (skuKey !== cSku && data.adCodes) {
      data.adCodes = data.adCodes.filter(c => normalizeKey(c) !== normalizeKey(normAd));
    }
  }

  if (!map[cSku].adCodes.some(c => normalizeKey(c) === normalizeKey(normAd))) {
    map[cSku].adCodes.push(normAd);
  }

  saveAttributionMap(map);
}

/**
 * Desvincula un alias o código de anuncio
 */
export function removeAttribution(targetCatalogSku: string, itemToRemove: string, type: 'alias' | 'adCode'): void {
  const map = loadAttributionMap();
  const cSku = targetCatalogSku.trim().toUpperCase();
  if (!map[cSku]) return;

  const norm = normalizeKey(itemToRemove);
  if (type === 'alias') {
    map[cSku].aliases = map[cSku].aliases.filter(a => normalizeKey(a) !== norm);
  } else {
    map[cSku].adCodes = map[cSku].adCodes.filter(c => normalizeKey(c) !== norm);
  }

  saveAttributionMap(map);
}
