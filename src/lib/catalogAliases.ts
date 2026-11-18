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
const RESET_FLAG_KEY = 'todoenuno_attribution_reset_v1';
const VAULT_CUTOFF_KEY = 'todoenuno_vault_cutoff_v1';
const INVENTORY_CUTOFF_KEY = 'todoenuno_inventory_cutoff_v1';

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
 * Mapeo semilla inicial (solo para instalaciones vírgenes antes del primer reinicio)
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
 * Cargar el mapa de atribución desde localStorage.
 * Respeta el reinicio desde 0 sin volver a inyectar SKUs viejos de Odoo.
 */
export function loadAttributionMap(): Record<string, { aliases: string[]; adCodes: string[] }> {
  try {
    const isReset = localStorage.getItem(RESET_FLAG_KEY) === '1';
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw === null) {
      if (isReset) {
        return {};
      }
      saveAttributionMap(DEFAULT_ATTRIBUTION_SEED);
      return { ...DEFAULT_ATTRIBUTION_SEED };
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return { ...parsed };
  } catch {
    return {};
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
 * Limpia todos los alias heredados y memorias locales roas_vault_* de la Bóveda
 */
export function resetVaultAndAliasesStorage(): void {
  try {
    localStorage.setItem(RESET_FLAG_KEY, '1');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('roas_vault_')) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (err) {
    console.error('Error limpiando almacenamiento local de Bóveda:', err);
  }
}

export function getVaultCutoffDate(): string | null {
  try {
    return localStorage.getItem(VAULT_CUTOFF_KEY) || null;
  } catch {
    return null;
  }
}

export function setVaultCutoffDate(iso: string | null): void {
  try {
    if (iso) {
      localStorage.setItem(VAULT_CUTOFF_KEY, iso);
    } else {
      localStorage.removeItem(VAULT_CUTOFF_KEY);
    }
  } catch {
    // ignorar
  }
}

export function getInventoryCutoffDate(): string | null {
  try {
    return localStorage.getItem(INVENTORY_CUTOFF_KEY) || null;
  } catch {
    return null;
  }
}

export function setInventoryCutoffDate(iso: string | null): void {
  try {
    if (iso) {
      localStorage.setItem(INVENTORY_CUTOFF_KEY, iso);
    } else {
      localStorage.removeItem(INVENTORY_CUTOFF_KEY);
    }
  } catch {
    // ignorar
  }
}

/**
 * Indica si un pedido (por su created_at) fue registrado antes o en el corte de reinicio.
 */
export function isOrderBeforeCutoff(
  createdAt: string | null | undefined,
  cutoffIso?: string | null
): boolean {
  const cutoff = cutoffIso !== undefined ? cutoffIso : getInventoryCutoffDate();
  if (!cutoff || !createdAt) return false;
  const orderMs = new Date(createdAt).getTime();
  const cutoffMs = new Date(cutoff).getTime();
  if (!Number.isFinite(orderMs) || !Number.isFinite(cutoffMs)) return false;
  return orderMs <= cutoffMs;
}

/**
 * Indica si un gasto publicitario pertenece a un período anterior al corte de Bóveda.
 */
export function isAdSpendBeforeCutoff(
  fecha: string | null | undefined,
  createdAt: string | null | undefined,
  cutoffIso?: string | null
): boolean {
  const cutoff = cutoffIso !== undefined ? cutoffIso : getVaultCutoffDate();
  if (!cutoff) return false;
  const cutoffMs = new Date(cutoff).getTime();
  if (!Number.isFinite(cutoffMs)) return false;

  if (createdAt) {
    const createdMs = new Date(createdAt).getTime();
    if (Number.isFinite(createdMs)) return createdMs <= cutoffMs;
  }

  if (fecha) {
    const cutoffDay = cutoff.slice(0, 10);
    return fecha.slice(0, 10) < cutoffDay;
  }

  return false;
}

/**
 * Sincroniza fechas de corte desde os_events si el navegador aún no las tiene en localStorage.
 */
export async function hydrateCutoffsFromOsEvents(supabaseClient: any): Promise<{
  vaultCutoff: string | null;
  inventoryCutoff: string | null;
}> {
  const localVault = getVaultCutoffDate();
  const localInv = getInventoryCutoffDate();

  if (localVault || localInv) {
    return { vaultCutoff: localVault, inventoryCutoff: localInv };
  }

  try {
    const { data, error } = await supabaseClient
      .from('os_events')
      .select('type,payload,occurred_at')
      .in('type', ['system.vault_reset', 'system.vault_cutoff_cleared'])
      .order('occurred_at', { ascending: false })
      .limit(1);

    if (!error && Array.isArray(data) && data.length > 0) {
      const latest = data[0];
      if (latest.type === 'system.vault_reset') {
        const p = latest.payload || {};
        const vCut = p.vault_cutoff || latest.occurred_at || null;
        const iCut = p.inventory_cutoff || null;
        if (vCut) setVaultCutoffDate(vCut);
        if (iCut) setInventoryCutoffDate(iCut);
        localStorage.setItem(RESET_FLAG_KEY, '1');
        return { vaultCutoff: vCut, inventoryCutoff: iCut };
      }
    }
  } catch {
    // os_events opcional
  }

  return { vaultCutoff: localVault, inventoryCutoff: localInv };
}

export interface CatalogResolutionIndex {
  masterSkus: string[];
  duplicateChildSkuSet: Set<string>;
  variantToParentSku: Record<string, string>;
  templateIdToParentSku: Record<string, string>;
  nameToParentSku: Record<string, string>;
  masterNameBySku: Record<string, string>;
}

/**
 * Elimina prefijos de cantidad ("2x ", "3 x ") y sufijos de variante entre paréntesis ("(Rosado)", "(Verde · M)")
 */
export function stripQtyAndVariantParens(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .replace(/^\s*\d+\s*[x×]\s*/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrae las unidades reales vendidas en un pedido (sumando items[].cantidad o prefijo "2x ...")
 */
export function extractOrderUnits(order: {
  items?: any;
  sku?: string | null;
  cantidad?: number | null;
}): number {
  const directQty = Number(order?.cantidad);
  if (Number.isFinite(directQty) && directQty > 0) {
    return Math.min(Math.round(directQty), 500);
  }

  if (Array.isArray(order?.items) && order.items.length > 0) {
    let total = 0;
    for (const item of order.items) {
      const q = Number(item?.cantidad ?? item?.qty ?? 1);
      total += Number.isFinite(q) && q > 0 ? Math.min(Math.round(q), 500) : 1;
    }
    if (total > 0) return total;
  }

  const raw = String(order?.sku || '').trim();
  if (raw) {
    const prefixMatch = raw.match(/^\s*(\d{1,3})\s*[x×]\b/i);
    if (prefixMatch?.[1]) {
      const q = Number(prefixMatch[1]);
      if (q > 0 && q <= 500) return q;
    }
  }

  return 1;
}

/**
 * Construye un índice maestro que mapea todas las variantes (SKU hijo, nombre con color/talla,
 * template_id y nombre base) de regreso a su único Producto Maestro padre.
 */
export function buildCatalogResolutionIndex(params: {
  stockItems?: Array<{
    sku?: string | null;
    nombre?: string | null;
    template_id?: string | number | null;
    image_url?: string | null;
    activo?: boolean | null;
  }>;
  variants?: Array<{
    variante_id?: string | number | null;
    template_id?: string | number | null;
    sku?: string | null;
    nombre_completo?: string | null;
    color?: string | null;
    talla?: string | null;
    estado?: string | null;
  }>;
  productosDb?: Array<{
    template_id?: string | number | null;
    nombre_base?: string | null;
    active?: boolean | null;
  }>;
  duplicateChildSkuSet?: Set<string>;
}): CatalogResolutionIndex {
  const stockItems = params.stockItems || [];
  const variants = params.variants || [];
  const productosDb = params.productosDb || [];

  const variantSkuSet = new Set<string>();
  const variantToParentSku: Record<string, string> = {};
  const templateIdToParentSku: Record<string, string> = {};
  const nameToParentSku: Record<string, string> = {};
  const masterNameBySku: Record<string, string> = {};

  for (const v of variants) {
    const vSku = String(v.sku || '').trim().toUpperCase();
    if (vSku) variantSkuSet.add(vSku);
  }

  // Detectar duplicados si no fueron provistos explícitamente
  const duplicateChildSkuSet = new Set<string>(
    Array.from(params.duplicateChildSkuSet || []).map(s => String(s).trim().toUpperCase())
  );

  // Agrupar filas de stock por template_id para detectar filas padre reales vs filas duplicadas de variante
  const rowsByTemplate = new Map<string, typeof stockItems>();
  for (const item of stockItems) {
    const s = String(item.sku || '').trim().toUpperCase();
    if (!s || s.toLowerCase().includes('fee')) continue;
    const tId = item.template_id !== undefined && item.template_id !== null ? String(item.template_id).trim() : '';
    if (tId) {
      const arr = rowsByTemplate.get(tId) || [];
      arr.push(item);
      rowsByTemplate.set(tId, arr);
    }
  }

  rowsByTemplate.forEach((rows, tId) => {
    if (rows.length <= 1) {
      const only = rows[0];
      const sku = String(only?.sku || '').trim().toUpperCase();
      if (sku) templateIdToParentSku[tId.toUpperCase()] = sku;
      return;
    }
    const sorted = [...rows].sort((a, b) => {
      const aSku = String(a.sku || '').trim().toUpperCase();
      const bSku = String(b.sku || '').trim().toUpperCase();
      const aIsVar = variantSkuSet.has(aSku) ? 1 : 0;
      const bIsVar = variantSkuSet.has(bSku) ? 1 : 0;
      if (aIsVar !== bIsVar) return aIsVar - bIsVar;
      const aImg = a.image_url ? 0 : 1;
      const bImg = b.image_url ? 0 : 1;
      if (aImg !== bImg) return aImg - bImg;
      return aSku.length - bSku.length;
    });

    const parent = sorted[0];
    const parentSku = String(parent?.sku || '').trim().toUpperCase();
    if (!parentSku) return;
    templateIdToParentSku[tId.toUpperCase()] = parentSku;

    for (let i = 1; i < sorted.length; i++) {
      const childSku = String(sorted[i]?.sku || '').trim().toUpperCase();
      if (!childSku) continue;
      if (variantSkuSet.has(childSku) || childSku.startsWith(`${parentSku}-`)) {
        duplicateChildSkuSet.add(childSku);
        variantToParentSku[childSku] = parentSku;
      }
    }
  });

  // Construir lista de SKUs maestros válidos (excluyendo filas duplicadas de variantes)
  const masterSkuSet = new Set<string>();
  for (const item of stockItems) {
    const sku = String(item.sku || '').trim().toUpperCase();
    if (!sku || sku.toLowerCase().includes('fee')) continue;
    if (duplicateChildSkuSet.has(sku)) continue;

    masterSkuSet.add(sku);
    const nombre = String(item.nombre || sku).trim();
    masterNameBySku[sku] = nombre;

    const tId = item.template_id !== undefined && item.template_id !== null ? String(item.template_id).trim().toUpperCase() : '';
    if (tId && !templateIdToParentSku[tId]) {
      templateIdToParentSku[tId] = sku;
    }

    const normName = normalizeKey(nombre);
    if (normName && !nameToParentSku[normName]) {
      nameToParentSku[normName] = sku;
    }
    const strippedName = normalizeKey(stripQtyAndVariantParens(nombre));
    if (strippedName && !nameToParentSku[strippedName]) {
      nameToParentSku[strippedName] = sku;
    }
  }

  // Vincular productos de tabla `productos` (legacy / complemento) con su SKU maestro por template_id o nombre
  for (const p of productosDb) {
    if (p.active === false) continue;
    const tId = p.template_id !== undefined && p.template_id !== null ? String(p.template_id).trim().toUpperCase() : '';
    const normBase = normalizeKey(p.nombre_base);

    let mappedMaster = tId ? templateIdToParentSku[tId] : undefined;
    if (!mappedMaster && normBase) {
      mappedMaster = nameToParentSku[normBase];
    }

    if (mappedMaster) {
      if (tId) templateIdToParentSku[tId] = mappedMaster;
      if (normBase && !nameToParentSku[normBase]) {
        nameToParentSku[normBase] = mappedMaster;
      }
    } else if (tId && !masterSkuSet.has(tId)) {
      masterSkuSet.add(tId);
      const label = String(p.nombre_base || tId).trim();
      masterNameBySku[tId] = label;
      templateIdToParentSku[tId] = tId;
      if (normBase) nameToParentSku[normBase] = tId;
    }
  }

  // Registrar TODAS las variantes (productos_variantes) hacia su SKU maestro padre
  const masterSkus = Array.from(masterSkuSet);
  for (const v of variants) {
    const vSku = String(v.sku || '').trim().toUpperCase();
    const tId = v.template_id !== undefined && v.template_id !== null ? String(v.template_id).trim().toUpperCase() : '';

    let parentSku = tId ? templateIdToParentSku[tId] : undefined;
    if (!parentSku && vSku) {
      // Buscar por prefijo del SKU maestro más largo que coincida con `${masterSku}-`
      const prefixMatches = masterSkus
        .filter(m => vSku === m || vSku.startsWith(`${m}-`))
        .sort((a, b) => b.length - a.length);
      if (prefixMatches[0]) {
        parentSku = prefixMatches[0];
      }
    }
    if (!parentSku && v.nombre_completo) {
      const strippedVar = normalizeKey(stripQtyAndVariantParens(v.nombre_completo));
      if (strippedVar && nameToParentSku[strippedVar]) {
        parentSku = nameToParentSku[strippedVar];
      }
    }

    if (parentSku) {
      if (vSku) variantToParentSku[vSku] = parentSku;
      if (v.nombre_completo) {
        const fullNorm = normalizeKey(v.nombre_completo);
        if (fullNorm) nameToParentSku[fullNorm] = parentSku;
        const strippedNorm = normalizeKey(stripQtyAndVariantParens(v.nombre_completo));
        if (strippedNorm && !nameToParentSku[strippedNorm]) {
          nameToParentSku[strippedNorm] = parentSku;
        }
      }
    }
  }

  // Segundo pase sobre duplicateChildSkuSet para asegurar mapeo por prefijo aunque faltara template_id
  for (const dupSku of duplicateChildSkuSet) {
    if (!variantToParentSku[dupSku]) {
      const prefixMatches = masterSkus
        .filter(m => dupSku.startsWith(`${m}-`))
        .sort((a, b) => b.length - a.length);
      if (prefixMatches[0]) {
        variantToParentSku[dupSku] = prefixMatches[0];
      }
    }
  }

  return {
    masterSkus,
    duplicateChildSkuSet,
    variantToParentSku,
    templateIdToParentSku,
    nameToParentSku,
    masterNameBySku,
  };
}

function canonicalizeToMaster(
  candidate: string | null | undefined,
  index?: CatalogResolutionIndex
): string | null {
  if (!candidate) return null;
  const upper = candidate.trim().toUpperCase();
  if (!upper) return null;
  if (!index) return upper;

  if (index.variantToParentSku[upper]) return index.variantToParentSku[upper];
  if (index.templateIdToParentSku[upper]) return index.templateIdToParentSku[upper];
  if (index.masterSkus.includes(upper)) return upper;

  const prefixMatch = index.masterSkus
    .filter(m => upper.startsWith(`${m}-`))
    .sort((a, b) => b.length - a.length)[0];
  if (prefixMatch) return prefixMatch;

  return upper;
}

/**
 * Resuelve el SKU del Catálogo Maestro al que pertenece una orden o gasto de publicidad
 * (unificando automáticamente variantes de color/talla y nombres libres al producto padre).
 */
export function resolveCatalogSku(
  rawSku: string | null | undefined,
  adCode: string | null | undefined,
  catalogoSku?: string | null | undefined,
  knownCatalogSkus: string[] = [],
  options?: {
    items?: any[];
    index?: CatalogResolutionIndex;
  }
): string | null {
  const index = options?.index;
  const effectiveSkus = index?.masterSkus.length ? index.masterSkus : knownCatalogSkus;

  // 1. Si ya tiene un catalogo_sku explícito, canonicalizarlo al SKU padre (por si trae SKU de variante o template_id)
  if (catalogoSku && catalogoSku.trim()) {
    const catUpper = catalogoSku.trim().toUpperCase();
    const mapped = canonicalizeToMaster(catUpper, index);
    if (mapped) return mapped;
  }

  // 2. Revisar items[] estructurados (si el pedido viene con detalle de líneas/variantes)
  if (Array.isArray(options?.items) && options.items.length > 0) {
    for (const item of options.items) {
      const candidates = [item?.catalogo_sku, item?.variante_sku, item?.sku];
      for (const c of candidates) {
        if (!c || typeof c !== 'string') continue;
        const cUpper = c.trim().toUpperCase();
        if (index?.variantToParentSku[cUpper]) return index.variantToParentSku[cUpper];
        if (index?.templateIdToParentSku[cUpper]) return index.templateIdToParentSku[cUpper];
        if (effectiveSkus.some(s => s.toUpperCase() === cUpper)) return cUpper;
        const prefix = effectiveSkus
          .filter(s => cUpper.startsWith(`${s.toUpperCase()}-`))
          .sort((a, b) => b.length - a.length)[0];
        if (prefix) return prefix.toUpperCase();
      }
      if (item?.nombre && index) {
        const normItem = normalizeKey(item.nombre);
        const strippedItem = normalizeKey(stripQtyAndVariantParens(item.nombre));
        if (normItem && index.nameToParentSku[normItem]) return index.nameToParentSku[normItem];
        if (strippedItem && index.nameToParentSku[strippedItem]) return index.nameToParentSku[strippedItem];
      }
    }
  }

  const map = loadAttributionMap();
  const normRawSku = normalizeKey(rawSku);
  const normStrippedRaw = normalizeKey(stripQtyAndVariantParens(rawSku));
  const rawUpper = String(rawSku || '').trim().toUpperCase();
  const normAdCode = normalizeKey(adCode);

  // 3. Coincidencia directa con variantes o nombres maestros del índice
  if (index) {
    if (rawUpper && index.variantToParentSku[rawUpper]) {
      return index.variantToParentSku[rawUpper];
    }
    if (rawUpper && index.templateIdToParentSku[rawUpper]) {
      return index.templateIdToParentSku[rawUpper];
    }
    if (normRawSku && index.nameToParentSku[normRawSku]) {
      return index.nameToParentSku[normRawSku];
    }
    if (normStrippedRaw && index.nameToParentSku[normStrippedRaw]) {
      return index.nameToParentSku[normStrippedRaw];
    }
  }

  // 4. Coincidencia exacta o por prefijo "PADRE-VARIANTE" con un SKU de catálogo conocido
  for (const cSku of effectiveSkus) {
    const cUpper = cSku.trim().toUpperCase();
    const normC = normalizeKey(cSku);
    if (normC === normRawSku || normC === normAdCode || (rawUpper && rawUpper.startsWith(`${cUpper}-`))) {
      return cUpper;
    }
  }

  // 5. Búsqueda en el mapa de atribución guardado (si apuntaba a una variante, canonicalizar al padre)
  for (const [masterSku, data] of Object.entries(map)) {
    const resolvedTarget = canonicalizeToMaster(masterSku, index) || masterSku.toUpperCase();
    const normMaster = normalizeKey(masterSku);
    if (normMaster && (normMaster === normRawSku || normMaster === normStrippedRaw || normMaster === normAdCode)) {
      return resolvedTarget;
    }

    if ((normRawSku || normStrippedRaw) && data.aliases) {
      for (const a of data.aliases) {
        const normA = normalizeKey(a);
        const normStrippedA = normalizeKey(stripQtyAndVariantParens(a));
        if (
          normA &&
          (normA === normRawSku ||
            normA === normStrippedRaw ||
            (normStrippedA && normStrippedA === normStrippedRaw) ||
            (normA.length > 4 && (normRawSku.includes(normA) || normA.includes(normRawSku))))
        ) {
          return resolvedTarget;
        }
      }
    }

    if (normAdCode && data.adCodes) {
      for (const ac of data.adCodes) {
        const normAc = normalizeKey(ac);
        if (normAc && (normAc === normAdCode || (normAc.length > 3 && (normAdCode.includes(normAc) || normAc.includes(normAdCode))))) {
          return resolvedTarget;
        }
      }
    }
  }

  // 6. Heurística por nombre de producto (contiene nombre maestro) o substring de SKU (ordenado por más largo primero)
  if (index && normStrippedRaw.length >= 4) {
    const nameEntries = Object.entries(index.nameToParentSku)
      .filter(([k]) => k.length >= 4)
      .sort((a, b) => b[0].length - a[0].length);
    for (const [nameKey, parentSku] of nameEntries) {
      if (normStrippedRaw.includes(nameKey) || nameKey.includes(normStrippedRaw)) {
        return parentSku;
      }
    }
  }

  if (normRawSku && effectiveSkus.length > 0) {
    const sortedSkus = [...effectiveSkus].sort((a, b) => b.length - a.length);
    for (const cSku of sortedSkus) {
      const normC = normalizeKey(cSku);
      if (normC.length > 4 && (normRawSku.includes(normC) || normC.includes(normRawSku))) {
        return cSku.toUpperCase();
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
