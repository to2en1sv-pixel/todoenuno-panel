import { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProductos, useVariantes, useInventory } from '@/hooks/useCatalog';
import {
  Search,
  Package,
  AlertTriangle,
  X,
  Plus,
  Code,
  Sparkles,
  Boxes,
  Layers,
  CheckCircle2,
  Upload,
  Trash2,
  Bot,
  MessageSquare,
  Tag,
  Save,
  Link as LinkIcon,
  ChevronRight,
  RefreshCw,
  Database,
  ExternalLink,
  EyeOff,
  PackageCheck,
  Video
} from 'lucide-react';
import {
  fetchStockItems,
  saveProductItem,
  compressImageFile,
  updateProductDetails,
  deleteProductItem,
  getToddProductConfig,
  buildVariantSku,
  createProductVariants,
  updateProductVariant,
  deleteProductVariant,
  syncVariantsToMasterAndTodd,
  formatVariantsForTodd,
  sanitizeToddInstructionsForPrivacy
} from '@/lib/inventory';
import {
  fetchToddCatalogSettings,
  saveToddCatalogSettings,
  getCachedToddCatalogSettings,
  extractYouTubeVideoId,
  cleanYouTubeUrl,
  getYouTubeThumbnailUrl,
  buildHowToVideoMessage,
  type ToddCatalogSettings
} from '@/lib/toddSettings';
import { ProductImg } from '@/components/inventory/ProductImg';
import { Sprint10SqlModal } from '@/components/inventory/Sprint10SqlModal';
import type { StockItem, ProductVariant } from '@/types/inventory';

const COLOR_HEX_MAP: Record<string, string> = {
  negro: '#18181b',
  negra: '#18181b',
  blanco: '#f8fafc',
  blanca: '#f8fafc',
  gris: '#71717a',
  plomo: '#52525b',
  azul: '#2563eb',
  'azul marino': '#1e3a8a',
  celeste: '#38bdf8',
  rojo: '#dc2626',
  roja: '#dc2626',
  vino: '#881337',
  rosado: '#ec4899',
  rosa: '#f472b6',
  verde: '#16a34a',
  oliva: '#65a30d',
  amarillo: '#eab308',
  amarilla: '#eab308',
  naranja: '#f97316',
  morado: '#9333ea',
  lila: '#c084fc',
  beige: '#d6c3a5',
  cafe: '#78350f',
  café: '#78350f',
  marron: '#78350f',
  marrón: '#78350f',
  dorado: '#ca8a04',
  plateado: '#cbd5e1',
  turquesa: '#14b8a6'
};

function getColorHex(colorName?: string | null): string {
  const k = (colorName || '').trim().toLowerCase();
  if (!k) return '#94a3b8';
  if (COLOR_HEX_MAP[k]) return COLOR_HEX_MAP[k];
  for (const [key, hex] of Object.entries(COLOR_HEX_MAP)) {
    if (k.includes(key)) return hex;
  }
  return '#6366f1';
}

const QUICK_COLORS = ['Negro', 'Blanco', 'Gris', 'Azul', 'Rojo', 'Rosado', 'Verde', 'Beige', 'Café'];
const QUICK_SIZES = ['Única', 'Estándar', 'XS', 'S', 'M', 'L', 'XL'];

interface UnifiedCatalogItem {
  key: string;
  sku: string;
  template_id: string | number | null;
  nombre: string;
  image_url: string | null;
  precio_venta: number;
  costo_unitario: number;
  stock_fisico: number;
  stock_reservado: number;
  stock_disponible: number;
  stock_minimo_alerta: number;
  ubicacion: string;
  activo: boolean;
  todd_pitch: string;
  todd_instrucciones: string;
  todd_keywords: string;
  activo_todd: boolean;
  categoria: string;
  source: 'native' | 'legacy';
}

type CatalogFilter = 'activos' | 'todd' | 'stock_bajo' | 'pausados';

export function CatalogoPage() {
  const [searchParams] = useSearchParams();
  const productos = useProductos();
  const variantes = useVariantes();
  const inv = useInventory();

  const [search, setSearch] = useState('');
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>('activos');
  const [selectedItem, setSelectedItem] = useState<UnifiedCatalogItem | null>(null);
  const [drawerTab, setDrawerTab] = useState<'info' | 'todd' | 'variantes'>('info');

  // Datos de catálogo sincronizados con Supabase
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [loadingNative, setLoadingNative] = useState(true);
  const [isRealDb, setIsRealDb] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
    showSqlAction?: boolean;
  } | null>(null);

  // Modales
  const [showProductoModal, setShowProductoModal] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteErrorBanner, setDeleteErrorBanner] = useState<string | null>(null);

  // Edición de Producto Seleccionado
  const [editNombre, setEditNombre] = useState('');
  const [editCategoria, setEditCategoria] = useState('General');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editPrecio, setEditPrecio] = useState('');
  const [editCosto, setEditCosto] = useState('');
  const [editStockMinimo, setEditStockMinimo] = useState('5');
  const [editUbicacion, setEditUbicacion] = useState('Bodega Central');
  const [editActivo, setEditActivo] = useState(true);
  const [editToddPitch, setEditToddPitch] = useState('');
  const [editToddInstrucciones, setEditToddInstrucciones] = useState('');
  const [editToddKeywords, setEditToddKeywords] = useState('');
  const [editActivoTodd, setEditActivoTodd] = useState(true);
  const [editVideoUrl, setEditVideoUrl] = useState('');
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);

  // Simulador de Todd Bot y Reglas Globales de Stock / Privacidad
  const [simRespuesta, setSimRespuesta] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [toddSettings, setToddSettings] = useState<ToddCatalogSettings>(() => getCachedToddCatalogSettings());
  const [savingToddSettings, setSavingToddSettings] = useState(false);

  // Formulario Nuevo Producto
  const [prodNombre, setProdNombre] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodCategoria, setProdCategoria] = useState('General');
  const [prodPrecio, setProdPrecio] = useState('');
  const [prodCosto, setProdCosto] = useState('');
  const [prodStockInicial, setProdStockInicial] = useState('0');
  const [prodStockMinimo, setProdStockMinimo] = useState('5');
  const [prodImagen, setProdImagen] = useState('');
  const [prodVideoUrl, setProdVideoUrl] = useState('');
  const [prodToddPitch, setProdToddPitch] = useState('');
  const [prodToddKeywords, setProdToddKeywords] = useState('');
  const [prodColoresInit, setProdColoresInit] = useState('');
  const [prodTallasInit, setProdTallasInit] = useState('Única');
  const [isSavingProd, setIsSavingProd] = useState(false);

  // Gestor de Variantes (Colores / Tallas / Stock)
  const [varMode, setVarMode] = useState<'single' | 'matrix'>('single');
  const [varColor, setVarColor] = useState('');
  const [varTalla, setVarTalla] = useState('Única');
  const [varStock, setVarStock] = useState('1');
  const [varPrecio, setVarPrecio] = useState('');
  const [varCustomSku, setVarCustomSku] = useState('');
  const [matrixColores, setMatrixColores] = useState('');
  const [matrixTallas, setMatrixTallas] = useState('Única');
  const [matrixStockPorVar, setMatrixStockPorVar] = useState('1');
  const [matrixPrecio, setMatrixPrecio] = useState('');
  const [syncMasterWithVariants, setSyncMasterWithVariants] = useState(true);
  const [syncToddWithVariants, setSyncToddWithVariants] = useState(true);
  const [isSavingVariant, setIsSavingVariant] = useState(false);
  const [editingVarStock, setEditingVarStock] = useState<Record<number, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const newProdFileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (type: 'ok' | 'err', text: string, showSqlAction = false) => {
    setToastMsg({ type, text, showSqlAction });
    setTimeout(() => {
      setToastMsg(prev => (prev?.text === text ? null : prev));
    }, 7000);
  };

  const loadCatalogData = async () => {
    setLoadingNative(true);
    const stockRes = await fetchStockItems();
    setStockItems(stockRes.items);
    setIsRealDb(stockRes.isRealDb);
    setDbError(stockRes.error || null);
    setLoadingNative(false);
  };

  useEffect(() => {
    loadCatalogData();
    fetchToddCatalogSettings().then(res => {
      setToddSettings(res.settings);
    });
  }, []);

  // UNIFICAR CATÁLOGO VISUAL: inventory_stock + public.productos sin duplicados
  const unifiedCatalog = useMemo<UnifiedCatalogItem[]>(() => {
    const result: UnifiedCatalogItem[] = [];
    const seenTemplateIds = new Set<string>();
    const seenSkus = new Set<string>();

    // 1. Items nativos de inventory_stock
    stockItems.forEach(s => {
      const skuClean = (s.sku || '').trim().toUpperCase();
      if (!skuClean || skuClean.includes('FEE')) return;

      const tId = s.template_id ? String(s.template_id) : null;
      if (tId) seenTemplateIds.add(tId);
      seenSkus.add(skuClean);

      const toddCfg = getToddProductConfig(skuClean);

      result.push({
        key: `native-${skuClean}`,
        sku: skuClean,
        template_id: tId,
        nombre: s.nombre || skuClean,
        image_url: s.image_url || null,
        precio_venta: Number(s.precio_venta) || 0,
        costo_unitario: Number(s.costo_unitario) || 0,
        stock_fisico: Number(s.stock_fisico) || 0,
        stock_reservado: Number(s.stock_reservado) || 0,
        stock_disponible: Number(s.stock_disponible) || 0,
        stock_minimo_alerta: Number(s.stock_minimo_alerta ?? 5),
        ubicacion: s.ubicacion || 'Bodega Central',
        activo: s.activo !== false,
        todd_pitch: s.todd_pitch || toddCfg.todd_pitch || '',
        todd_instrucciones: s.todd_instrucciones || toddCfg.todd_instrucciones || '',
        todd_keywords: s.todd_keywords || toddCfg.todd_keywords || '',
        activo_todd: s.activo_todd !== undefined ? s.activo_todd : toddCfg.activo_todd,
        categoria: s.categoria || 'General',
        source: 'native'
      });
    });

    // 2. Productos legacy que aún no están en inventory_stock
    (productos.data ?? []).forEach((p: any) => {
      const tIdStr = String(p.template_id);
      const nombre = (p.nombre_base || '').trim();
      const lower = nombre.toLowerCase();
      if (lower.includes('fee') || lower.includes('servicio') || lower.includes('envio')) return;

      if (seenTemplateIds.has(tIdStr)) {
        const existing = result.find(r => String(r.template_id) === tIdStr);
        if (existing && !existing.image_url && p.image_url) {
          existing.image_url = p.image_url;
        }
        return;
      }

      const vars = (variantes.data ?? []).filter((v: any) => String(v.template_id) === tIdStr);
      const firstSku = vars[0]?.sku ? String(vars[0].sku).trim().toUpperCase() : `PROD-${tIdStr}`;

      if (seenSkus.has(firstSku)) return;
      seenSkus.add(firstSku);
      seenTemplateIds.add(tIdStr);

      let disp = 0;
      const varSkus = new Set(vars.map((v: any) => String(v.sku || '').trim().toUpperCase()).filter(Boolean));
      stockItems.forEach(s => {
        if (varSkus.has(s.sku.toUpperCase())) disp += Number(s.stock_disponible) || 0;
      });
      if (disp === 0 && inv.data) {
        inv.data.forEach((i: any) => {
          if (varSkus.has(String(i.sku || '').trim().toUpperCase())) disp += Number(i.qty) || 0;
        });
      }

      const toddCfg = getToddProductConfig(tIdStr);

      result.push({
        key: `legacy-${tIdStr}`,
        sku: firstSku,
        template_id: p.template_id,
        nombre: nombre || firstSku,
        image_url: p.image_url || null,
        precio_venta: Number(vars[0]?.precio) || 0,
        costo_unitario: 0,
        stock_fisico: disp,
        stock_reservado: 0,
        stock_disponible: disp,
        stock_minimo_alerta: 5,
        ubicacion: 'Bodega Central',
        activo: p.active !== false,
        todd_pitch: p.todd_pitch || toddCfg.todd_pitch || '',
        todd_instrucciones: p.todd_instrucciones || toddCfg.todd_instrucciones || '',
        todd_keywords: p.todd_keywords || toddCfg.todd_keywords || '',
        activo_todd: p.activo_todd !== undefined ? p.activo_todd : toddCfg.activo_todd,
        categoria: 'General',
        source: 'legacy'
      });
    });

    return result.sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [stockItems, productos.data, variantes.data, inv.data]);

  const handleOpenItem = (item: UnifiedCatalogItem) => {
    setSelectedItem(item);
    setEditNombre(item.nombre);
    setEditCategoria(item.categoria || 'General');
    setEditImageUrl(item.image_url || '');
    setEditActivo(item.activo);
    setEditPrecio(item.precio_venta ? String(item.precio_venta) : '');
    setEditCosto(item.costo_unitario ? String(item.costo_unitario) : '');
    setEditStockMinimo(String(item.stock_minimo_alerta ?? 5));
    setEditUbicacion(item.ubicacion || 'Bodega Central');
    setEditToddPitch(item.todd_pitch || '');
    setEditToddInstrucciones(item.todd_instrucciones || '');
    setEditToddKeywords(item.todd_keywords || '');
    setEditActivoTodd(item.activo_todd);
    setEditVideoUrl(toddSettings.productVideos[item.sku.toUpperCase()] || '');
    setDrawerTab('info');
    setSimRespuesta('');
    setShowUrlInput(false);
    setDeleteErrorBanner(null);
    setVarColor('');
    setVarTalla('Única');
    setVarStock('1');
    setVarPrecio(item.precio_venta ? String(item.precio_venta) : '');
    setVarCustomSku('');
    setMatrixColores('');
    setMatrixTallas('Única');
    setMatrixStockPorVar('1');
    setMatrixPrecio(item.precio_venta ? String(item.precio_venta) : '');
    setEditingVarStock({});
  };

  // Si llega con ?sku=XYZ desde Inventario, abrir ficha automáticamente
  useEffect(() => {
    const skuParam = searchParams.get('sku');
    if (skuParam && unifiedCatalog.length > 0) {
      const target = unifiedCatalog.find(i => i.sku.toUpperCase() === skuParam.toUpperCase());
      if (target && selectedItem?.sku !== target.sku) {
        handleOpenItem(target);
      }
    }
  }, [searchParams, unifiedCatalog.length]);

  // Mantener selectedItem sincronizado tras recargas
  useEffect(() => {
    if (selectedItem) {
      const updated = unifiedCatalog.find(
        u => u.sku === selectedItem.sku || (u.template_id && u.template_id === selectedItem.template_id)
      );
      if (updated) {
        setSelectedItem(updated);
      }
    }
  }, [stockItems, unifiedCatalog]);

  // Métricas comerciales del Catálogo Visual (excluye estrictamente productos pausados)
  const catalogStats = useMemo(() => {
    const activeItems = unifiedCatalog.filter(i => i.activo);
    const pausados = unifiedCatalog.length - activeItems.length;
    const activos = activeItems.length;
    const toddReady = activeItems.filter(i => i.activo_todd && Boolean(i.todd_pitch)).length;
    const sinFoto = activeItems.filter(i => !i.image_url).length;
    const stockBajo = activeItems.filter(i => i.stock_disponible <= (i.stock_minimo_alerta || 5)).length;
    const valorVentaActivo = activeItems.reduce(
      (sum, i) => sum + (i.stock_fisico || 0) * (i.precio_venta || 0),
      0
    );
    return { activos, pausados, toddReady, sinFoto, stockBajo, valorVentaActivo };
  }, [unifiedCatalog]);

  // Filtrado visual (por defecto solo muestra activos)
  const filteredCatalog = useMemo(() => {
    let list = unifiedCatalog;

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        item =>
          item.nombre.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          (item.categoria || '').toLowerCase().includes(q) ||
          String(item.template_id || '').toLowerCase().includes(q)
      );
    }

    if (catalogFilter === 'activos') list = list.filter(i => i.activo);
    else if (catalogFilter === 'todd') {
      list = list.filter(i => i.activo && i.activo_todd && Boolean(i.todd_pitch));
    } else if (catalogFilter === 'stock_bajo') {
      list = list.filter(i => i.activo && i.stock_disponible <= (i.stock_minimo_alerta || 5));
    } else if (catalogFilter === 'pausados') {
      list = list.filter(i => !i.activo);
    }

    return list;
  }, [unifiedCatalog, search, catalogFilter]);

  // Mapa rápido template_id -> variantes para pintar badges en tarjetas del catálogo
  const variantsByTemplateId = useMemo(() => {
    const map = new Map<string, ProductVariant[]>();
    (variantes.data ?? []).forEach((v: any) => {
      const k = String(v.template_id || '').trim();
      if (!k) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push({
        variante_id: Number(v.variante_id),
        template_id: Number(v.template_id),
        sku: String(v.sku || '').toUpperCase(),
        nombre_completo: v.nombre_completo || v.sku || '',
        color: v.color || '',
        talla: v.talla || 'Única',
        stock: Number(v.stock) || 0,
        precio: Number(v.precio) || 0,
        estado: v.estado || 'DISPONIBLE',
        image_url: v.image_url || null
      });
    });
    return map;
  }, [variantes.data]);

  const productVariants = useMemo<ProductVariant[]>(() => {
    if (!selectedItem || !selectedItem.template_id) return [];
    return variantsByTemplateId.get(String(selectedItem.template_id)) || [];
  }, [variantsByTemplateId, selectedItem]);

  const totalVariantsStock = useMemo(
    () => productVariants.filter(v => v.estado !== 'PAUSADO').reduce((s, v) => s + Math.max(v.stock || 0, 0), 0),
    [productVariants]
  );

  const backorderSkuSet = useMemo(
    () => new Set(toddSettings.backorderSkus.map(s => s.toUpperCase())),
    [toddSettings.backorderSkus]
  );

  const isSelectedBackorderEnabled = useMemo(() => {
    if (!selectedItem) return false;
    return toddSettings.allowBackorderGlobal || backorderSkuSet.has(selectedItem.sku.toUpperCase());
  }, [selectedItem, toddSettings.allowBackorderGlobal, backorderSkuSet]);

  const toddVariantsPreview = useMemo(
    () =>
      formatVariantsForTodd(
        productVariants,
        parseFloat(editPrecio || '0') || selectedItem?.precio_venta || 0,
        {
          allowBackorder: isSelectedBackorderEnabled,
          hideExactCounts: toddSettings.hideExactStockCounts
        }
      ),
    [productVariants, editPrecio, selectedItem?.precio_venta, isSelectedBackorderEnabled, toddSettings.hideExactStockCounts]
  );

  const persistToddSettings = async (next: ToddCatalogSettings, feedbackMsg: string) => {
    setToddSettings(next);
    setSavingToddSettings(true);
    const res = await saveToddCatalogSettings(next);
    setSavingToddSettings(false);
    if (res.source === 'supabase') {
      showToast('ok', feedbackMsg);
    } else {
      showToast('ok', `${feedbackMsg} (guardado local; verifica conexión si no sincroniza)`);
    }
  };

  const handleToggleGlobalBackorder = async () => {
    const nextVal = !toddSettings.allowBackorderGlobal;
    await persistToddSettings(
      { ...toddSettings, allowBackorderGlobal: nextVal },
      nextVal
        ? 'Venta sin stock GLOBAL activada: Todd no pausará ni rechazará productos en 0 uds.'
        : 'Venta sin stock GLOBAL desactivada (se respetará stock físico salvo productos bajo pedido).'
    );
  };

  const handleToggleHideExactStockCounts = async () => {
    const nextVal = !toddSettings.hideExactStockCounts;
    await persistToddSettings(
      { ...toddSettings, hideExactStockCounts: nextVal },
      nextVal
        ? 'Privacidad activada: Bot Todd nunca revelará cuántas unidades disponibles quedan.'
        : 'Privacidad desactivada: Bot Todd podrá mencionar cantidades exactas si aplica.'
    );
  };

  const handleToggleSkuBackorder = async (sku: string) => {
    const skuClean = sku.trim().toUpperCase();
    if (!skuClean) return;
    const exists = backorderSkuSet.has(skuClean);
    const nextSkus = exists
      ? toddSettings.backorderSkus.filter(s => s.toUpperCase() !== skuClean)
      : [...toddSettings.backorderSkus, skuClean];

    await persistToddSettings(
      { ...toddSettings, backorderSkus: nextSkus },
      exists
        ? `Venta sin stock desactivada para ${skuClean}.`
        : `Venta sin stock (bajo pedido) activada para ${skuClean}: Todd seguirá vendiéndolo aunque esté en 0.`
    );
  };

  const refreshAfterVariantChange = async (masterSku: string) => {
    const [, freshStock] = await Promise.all([variantes.refetch(), fetchStockItems(), productos.refetch()]);
    setStockItems(freshStock.items);
    const updatedItem = freshStock.items.find(s => s.sku.toUpperCase() === masterSku.toUpperCase());
    if (updatedItem) {
      if (updatedItem.todd_instrucciones !== undefined) {
        setEditToddInstrucciones(updatedItem.todd_instrucciones || '');
      }
      if (updatedItem.todd_keywords !== undefined) {
        setEditToddKeywords(updatedItem.todd_keywords || '');
      }
    }
  };

  const handleAddSingleVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    if (!varColor.trim() && !varTalla.trim()) {
      showToast('err', 'Ingresa al menos un color o una talla para crear la variante.');
      return;
    }

    setIsSavingVariant(true);
    const res = await createProductVariants({
      masterSku: selectedItem.sku,
      templateId: selectedItem.template_id,
      productName: editNombre.trim() || selectedItem.nombre,
      basePrice: parseFloat(editPrecio || '0') || selectedItem.precio_venta,
      productImage: editImageUrl.trim() || selectedItem.image_url,
      variantsToCreate: [
        {
          color: varColor.trim() || 'Estándar',
          talla: varTalla.trim() || 'Única',
          stock: Math.max(parseInt(varStock || '0', 10) || 0, 0),
          precio: varPrecio !== '' ? parseFloat(varPrecio) : undefined,
          sku: varCustomSku.trim() || undefined
        }
      ],
      syncMasterStock: syncMasterWithVariants,
      syncToddDetails: syncToddWithVariants
    });
    setIsSavingVariant(false);

    if (res.success) {
      showToast(
        'ok',
        `Variante agregada (${res.createdCount}) y sincronizada con Bodega y Bot Todd.`
      );
      setVarColor('');
      setVarCustomSku('');
      await refreshAfterVariantChange(selectedItem.sku);
    } else {
      showToast('err', res.error || 'No se pudo agregar la variante en Supabase.');
    }
  };

  const handleGenerateMatrixVariants = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    const colores = matrixColores
      .split(',')
      .map(c => c.trim())
      .filter(Boolean);
    const tallas = matrixTallas
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

    if (colores.length === 0) {
      showToast('err', 'Ingresa al menos un color separado por coma (ej. Negro, Gris, Azul).');
      return;
    }

    const tallasFinal = tallas.length > 0 ? tallas : ['Única'];
    const qtyEach = Math.max(parseInt(matrixStockPorVar || '0', 10) || 0, 0);
    const priceVal = matrixPrecio !== '' ? parseFloat(matrixPrecio) : undefined;

    const toCreate = colores.flatMap(color =>
      tallasFinal.map(talla => ({
        color,
        talla,
        stock: qtyEach,
        precio: priceVal
      }))
    );

    setIsSavingVariant(true);
    const res = await createProductVariants({
      masterSku: selectedItem.sku,
      templateId: selectedItem.template_id,
      productName: editNombre.trim() || selectedItem.nombre,
      basePrice: parseFloat(editPrecio || '0') || selectedItem.precio_venta,
      productImage: editImageUrl.trim() || selectedItem.image_url,
      variantsToCreate: toCreate,
      syncMasterStock: syncMasterWithVariants,
      syncToddDetails: syncToddWithVariants
    });
    setIsSavingVariant(false);

    if (res.success) {
      showToast('ok', `${res.createdCount} variante(s) generadas y sincronizadas con Bodega y Bot Todd.`);
      setMatrixColores('');
      await refreshAfterVariantChange(selectedItem.sku);
    } else {
      showToast('err', res.error || 'No se pudieron generar las variantes.');
    }
  };

  const handleVariantStockUpdate = async (v: ProductVariant, newStock: number) => {
    if (!selectedItem || !v.template_id) return;
    const cleanQty = Math.max(Math.round(newStock), 0);
    setIsSavingVariant(true);
    const res = await updateProductVariant({
      varianteId: v.variante_id,
      masterSku: selectedItem.sku,
      templateId: v.template_id,
      productName: editNombre.trim() || selectedItem.nombre,
      basePrice: parseFloat(editPrecio || '0') || selectedItem.precio_venta,
      patch: { stock: cleanQty },
      syncMasterStock: syncMasterWithVariants,
      syncToddDetails: syncToddWithVariants
    });
    setIsSavingVariant(false);

    if (res.success) {
      setEditingVarStock(prev => {
        const next = { ...prev };
        delete next[v.variante_id];
        return next;
      });
      await refreshAfterVariantChange(selectedItem.sku);
    } else {
      showToast('err', res.error || 'Error actualizando stock de variante.');
    }
  };

  const handleDeleteVariant = async (v: ProductVariant) => {
    if (!selectedItem || !v.template_id) return;
    setIsSavingVariant(true);
    const res = await deleteProductVariant({
      varianteId: v.variante_id,
      variantSku: v.sku,
      masterSku: selectedItem.sku,
      templateId: v.template_id,
      productName: editNombre.trim() || selectedItem.nombre,
      basePrice: parseFloat(editPrecio || '0') || selectedItem.precio_venta,
      syncMasterStock: syncMasterWithVariants,
      syncToddDetails: syncToddWithVariants
    });
    setIsSavingVariant(false);

    if (res.success) {
      showToast('ok', `Variante ${v.color} (${v.talla}) eliminada.`);
      await refreshAfterVariantChange(selectedItem.sku);
    } else {
      showToast('err', res.error || 'No se pudo eliminar la variante.');
    }
  };

  const handleForceSyncToddVariants = async () => {
    if (!selectedItem || !selectedItem.template_id) return;
    setIsSavingVariant(true);
    await syncVariantsToMasterAndTodd({
      masterSku: selectedItem.sku,
      templateId: Number(selectedItem.template_id),
      productName: editNombre.trim() || selectedItem.nombre,
      basePrice: parseFloat(editPrecio || '0') || selectedItem.precio_venta,
      syncMasterStock: syncMasterWithVariants,
      syncToddDetails: true,
      allowBackorder: isSelectedBackorderEnabled,
      hideExactCounts: toddSettings.hideExactStockCounts
    });
    setIsSavingVariant(false);
    showToast('ok', 'Colores, tallas y disponibilidad sincronizados con Bot Todd y Bodega.');
    await refreshAfterVariantChange(selectedItem.sku);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingPhoto(true);
      const compressedDataUrl = await compressImageFile(file, 800, 800, 0.82);
      setEditImageUrl(compressedDataUrl);

      if (selectedItem) {
        const res = await updateProductDetails({
          sku: selectedItem.sku,
          template_id: selectedItem.template_id,
          nombre_base: editNombre.trim() || selectedItem.nombre,
          image_url: compressedDataUrl
        });
        if (res.success) {
          showToast('ok', 'Foto optimizada y guardada en Supabase.');
        } else {
          showToast('err', res.error || 'No se pudo guardar la foto.');
        }
        await Promise.all([productos.refetch(), loadCatalogData()]);
      }
    } catch (err: any) {
      showToast('err', err?.message || 'Error al procesar imagen.');
    } finally {
      setIsUploadingPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleNewProdFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 800, 800, 0.82);
      setProdImagen(compressed);
    } catch {
      showToast('err', 'No se pudo procesar la foto seleccionada.');
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleSaveProductDetails = async () => {
    if (!selectedItem) return;
    setIsSavingDetails(true);

    const res = await updateProductDetails({
      sku: selectedItem.sku,
      template_id: selectedItem.template_id,
      nombre_base: editNombre.trim() || selectedItem.nombre,
      categoria: editCategoria.trim() || 'General',
      image_url: editImageUrl.trim() || null,
      active: editActivo,
      precio_venta: parseFloat(editPrecio || '0'),
      costo_unitario: parseFloat(editCosto || '0'),
      stock_minimo_alerta: parseInt(editStockMinimo || '5', 10),
      ubicacion: editUbicacion.trim() || 'Bodega Central',
      todd_pitch: editToddPitch.trim(),
      todd_instrucciones: editToddInstrucciones.trim(),
      todd_keywords: editToddKeywords.trim(),
      activo_todd: editActivoTodd
    });

    const skuKey = selectedItem.sku.trim().toUpperCase();
    const cleanVideo = cleanYouTubeUrl(editVideoUrl);
    if (cleanVideo !== editVideoUrl) {
      setEditVideoUrl(cleanVideo);
    }
    const currentSavedVideo = toddSettings.productVideos[skuKey] || '';
    if (cleanVideo !== currentSavedVideo) {
      const nextVideos = { ...toddSettings.productVideos };
      if (cleanVideo) nextVideos[skuKey] = cleanVideo;
      else delete nextVideos[skuKey];
      const nextSettings: ToddCatalogSettings = { ...toddSettings, productVideos: nextVideos };
      setToddSettings(nextSettings);
      await saveToddCatalogSettings(nextSettings);
    }

    setIsSavingDetails(false);

    if (res.success) {
      showToast('ok', `Ficha de "${editNombre.trim()}" actualizada en Supabase.`);
      await Promise.all([productos.refetch(), loadCatalogData()]);
    } else {
      showToast('err', `Error guardando en Supabase: ${res.error}`);
    }
  };

  const handleDeleteProduct = async (hardDelete: boolean) => {
    if (!selectedItem) return;
    setIsSavingDetails(true);
    setDeleteErrorBanner(null);

    const res = await deleteProductItem({
      sku: selectedItem.sku,
      template_id: selectedItem.template_id,
      hardDelete,
      nombre: selectedItem.nombre,
      precio_venta: selectedItem.precio_venta,
      costo_unitario: selectedItem.costo_unitario,
      image_url: selectedItem.image_url
    });

    setIsSavingDetails(false);

    if (res.success) {
      showToast(
        'ok',
        hardDelete
          ? `Producto ${selectedItem.sku} eliminado definitivamente de Supabase.`
          : `Producto ${selectedItem.sku} pausado correctamente.`
      );
      setShowDeleteModal(false);
      setSelectedItem(null);
      await Promise.all([productos.refetch(), variantes.refetch(), inv.refetch(), loadCatalogData()]);
    } else {
      const msg = res.error || 'Error al eliminar producto.';
      setDeleteErrorBanner(msg);
      showToast('err', `Error al eliminar: ${msg}`, Boolean(res.needsSqlRepair));
    }
  };

  const handleSimulateTodd = () => {
    if (!selectedItem) return;
    setIsSimulating(true);

    const hideCounts = toddSettings.hideExactStockCounts;
    const allowBackorder = isSelectedBackorderEnabled;
    const pitch = editToddPitch || 'Es un producto de alta calidad disponible para entrega inmediata.';
    const rawInstr = hideCounts ? sanitizeToddInstructionsForPrivacy(editToddInstrucciones) : editToddInstrucciones;
    const reglas = rawInstr ? `\n(Regla del bot: ${rawInstr})` : '';
    const precio = editPrecio ? `$${parseFloat(editPrecio).toFixed(2)}` : '$25.00';

    const disponiblesVars = productVariants.filter(
      v => v.estado !== 'PAUSADO' && (v.stock > 0 || allowBackorder)
    );
    const variantesTxt = disponiblesVars.length > 0
      ? `\n\n🎨 *Opciones disponibles:*\n` +
        disponiblesVars
          .map(v => {
            const label = [v.color, v.talla && v.talla !== 'Única' ? `Talla ${v.talla}` : ''].filter(Boolean).join(' · ');
            return hideCounts ? `• ${label}: Disponible` : `• ${label}: ${v.stock} disp.`;
          })
          .join('\n')
      : '';

    const totalUds = disponiblesVars.length > 0 ? totalVariantsStock : selectedItem.stock_disponible;
    const isProductSellable = totalUds > 0 || allowBackorder;
    const availabilityLine = !isProductSellable
      ? '⏳ *Estado:* Agotado temporalmente (te aviso cuando ingrese).'
      : hideCounts
        ? '📦 *Disponibilidad:* Disponible para envío en 24-48 horas.'
        : `📦 *Disponibilidad total:* Tenemos ${totalUds} uds listas para envío en 24-48 horas.`;

    const videoFollowUp = editVideoUrl.trim()
      ? `\n\n--- Mensaje 2 automático (con vista previa YouTube) ---\n${buildHowToVideoMessage(
          editNombre || selectedItem.nombre,
          editVideoUrl.trim()
        )}`
      : '';

    setTimeout(() => {
      setSimRespuesta(
        `¡Hola! 👋 Gracias por consultar por el *${editNombre || selectedItem.nombre}*.\n\n` +
          `${pitch}\n\n` +
          `💰 *Precio especial:* ${precio} USD con pago contra entrega en todo El Salvador 🇸🇻.` +
          `${variantesTxt}\n` +
          `${availabilityLine}${reglas}\n\n` +
          `¿Qué color o talla te gustaría pedir y a qué dirección te lo enviamos? 📲` +
          videoFollowUp
      );
      setIsSimulating(false);
    }, 250);
  };

  const handleSaveProducto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodNombre.trim() || !prodSku.trim()) return;
    setIsSavingProd(true);

    const coloresInit = prodColoresInit
      .split(',')
      .map(c => c.trim())
      .filter(Boolean);
    const tallasInit = prodTallasInit
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const tieneVariantesIniciales = coloresInit.length > 0;
    const stockInputVal = Math.max(parseInt(prodStockInicial || '0', 10) || 0, 0);
    const skuClean = prodSku.toUpperCase().trim();
    const precioVal = parseFloat(prodPrecio || '0');

    const res = await saveProductItem({
      nombre: prodNombre.trim(),
      sku: skuClean,
      categoria: prodCategoria.trim() || 'General',
      precio_venta: precioVal,
      costo_unitario: parseFloat(prodCosto || '0'),
      stock_inicial: tieneVariantesIniciales ? 0 : stockInputVal,
      stock_minimo: parseInt(prodStockMinimo || '5', 10),
      image_url: prodImagen.trim() || undefined,
      todd_pitch: prodToddPitch.trim() || undefined,
      todd_keywords: prodToddKeywords.trim() || undefined
    });

    if (res.success && tieneVariantesIniciales) {
      const tallasList = tallasInit.length > 0 ? tallasInit : ['Única'];
      const varsToCreate = coloresInit.flatMap(color =>
        tallasList.map(talla => ({
          color,
          talla,
          stock: stockInputVal,
          precio: precioVal
        }))
      );
      await createProductVariants({
        masterSku: skuClean,
        templateId: res.item?.template_id,
        productName: prodNombre.trim(),
        basePrice: precioVal,
        productImage: prodImagen.trim() || null,
        variantsToCreate: varsToCreate,
        syncMasterStock: true,
        syncToddDetails: true
      });
    }

    const cleanNewVideo = cleanYouTubeUrl(prodVideoUrl);
    if (res.success && cleanNewVideo) {
      const nextVideos = {
        ...toddSettings.productVideos,
        [skuClean]: cleanNewVideo
      };
      const nextSettings: ToddCatalogSettings = { ...toddSettings, productVideos: nextVideos };
      setToddSettings(nextSettings);
      await saveToddCatalogSettings(nextSettings);
    }

    setIsSavingProd(false);

    if (res.success) {
      showToast(
        'ok',
        tieneVariantesIniciales
          ? `Producto "${prodNombre.trim()}" y sus variantes creados y sincronizados con Bot Todd.`
          : `Producto "${prodNombre.trim()}" (${skuClean}) creado en Supabase.`
      );
      setShowProductoModal(false);
      setProdNombre('');
      setProdSku('');
      setProdCategoria('General');
      setProdPrecio('');
      setProdCosto('');
      setProdStockInicial('0');
      setProdStockMinimo('5');
      setProdImagen('');
      setProdVideoUrl('');
      setProdToddPitch('');
      setProdToddKeywords('');
      setProdColoresInit('');
      setProdTallasInit('Única');
      await Promise.all([productos.refetch(), variantes.refetch(), loadCatalogData()]);
    } else {
      showToast('err', res.error || 'No se pudo crear el producto en Supabase.');
    }
  };

  // Margen unitario en tiempo real dentro del drawer
  const liveMargin = useMemo(() => {
    const p = parseFloat(editPrecio || '0');
    const c = parseFloat(editCosto || '0');
    if (p <= 0) return null;
    const diff = p - c;
    const pct = (diff / p) * 100;
    return { diff, pct };
  }, [editPrecio, editCosto]);

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5 pb-14 h-full">
      {/* Inputs de archivo ocultos */}
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
      <input type="file" ref={newProdFileInputRef} onChange={handleNewProdFileUpload} accept="image/*" className="hidden" />

      {/* Toast flotante */}
      {toastMsg && (
        <div
          className={`fixed bottom-5 right-5 z-[60] max-w-md px-4 py-3 rounded-2xl shadow-2xl border flex items-start gap-2.5 text-xs font-bold animate-in fade-in slide-in-from-bottom-4 ${
            toastMsg.type === 'ok'
              ? 'bg-emerald-950/95 border-emerald-500/50 text-emerald-200'
              : 'bg-rose-950/95 border-rose-500/50 text-rose-200'
          }`}
        >
          {toastMsg.type === 'ok' ? (
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 space-y-1.5">
            <div>{toastMsg.text}</div>
            {toastMsg.showSqlAction && (
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setShowSqlModal(true);
                }}
                className="px-2.5 py-1 bg-amber-400 text-zinc-950 rounded-lg text-[11px] font-black inline-flex items-center gap-1"
              >
                <Code size={12} /> Abrir Script SQL Reparador
              </button>
            )}
          </div>
          <button onClick={() => setToastMsg(null)} className="opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Alerta SQL Supabase */}
      {(!isRealDb || dbError) && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs">
            <Database size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-amber-600 dark:text-amber-400 block">
                Conexión con Supabase pendiente de actualizar (Sprint 10)
              </span>
              <span className="tx-mu block mt-0.5">
                {dbError ||
                  'Ejecuta el script SQL Sprint 10 en Supabase para habilitar eliminación en cascada, catálogo unificado y fichas de Bot Todd.'}
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowSqlModal(true)}
            className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-xl text-xs font-black flex items-center gap-1.5 shrink-0 transition-colors"
          >
            <Code size={14} /> Copiar SQL Reparador
          </button>
        </div>
      )}

      {/* Encabezado Principal de Catálogo Visual */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div className="min-w-0 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <Tag className="text-[var(--ac)] shrink-0" size={24} />
            <h1 className="text-xl sm:text-2xl font-black tracking-tight whitespace-normal sm:whitespace-nowrap">
              Catálogo Visual
            </h1>
            <span
              className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border shrink-0 flex items-center gap-1 ${
                isRealDb
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
              }`}
            >
              <Database size={10} /> {isRealDb ? 'Supabase Conectado' : 'Modo Respaldo'}
            </span>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30 flex items-center gap-1 shrink-0">
              <Bot size={12} /> Todd Ready
            </span>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1 max-w-xl">
            Fichas comerciales de tus productos: fotos, precios de venta, variantes, estado activo y entrenamiento de Bot Todd para WhatsApp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          <Link
            to="/inventario"
            className="px-3.5 py-2 border border-[var(--bd)] bg-sf hover:bg-cd rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <Boxes size={15} className="text-emerald-500" /> Inventario & Kárdex <ExternalLink size={12} />
          </Link>

          <button
            onClick={() => setShowProductoModal(true)}
            className="flex-1 sm:flex-none px-4 py-2 bg-[var(--ac)] text-white hover:opacity-90 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-opacity shadow-sm"
          >
            <Plus size={14} /> Nuevo Producto
          </button>

          <button
            onClick={loadCatalogData}
            className="p-2 border border-[var(--bd)] rounded-xl text-xs font-bold hover:bg-sf transition-colors"
            title="Recargar catálogo desde Supabase"
          >
            <RefreshCw size={16} className={loadingNative ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setShowSqlModal(true)}
            className="p-2 border border-[var(--bd)] rounded-xl text-xs font-bold hover:bg-sf transition-colors"
            title="Script SQL Sprint 10 (Supabase)"
          >
            <Code size={16} />
          </button>
        </div>
      </div>

      {/* KPIs Comerciales del Catálogo (Solo productos activos) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">
            Productos Activos
          </span>
          <div className="text-2xl font-black mt-1 text-[var(--tx)]">{catalogStats.activos}</div>
          <span className="text-[10px] tx-mu mt-1 block">Visibles para venta y Todd</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">
            Valor en Venta (PVP)
          </span>
          <div className="text-2xl font-black mt-1 text-emerald-500">
            ${catalogStats.valorVentaActivo.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Stock activo a precio venta</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">
            Entrenados Bot Todd
          </span>
          <div className="text-2xl font-black mt-1 text-purple-500">{catalogStats.toddReady}</div>
          <span className="text-[10px] tx-mu mt-1 block">Activos con pitch WhatsApp</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">
            Fichas sin Foto
          </span>
          <div className="text-2xl font-black mt-1 text-amber-500">{catalogStats.sinFoto}</div>
          <span className="text-[10px] tx-mu mt-1 block">Activos sin imagen</span>
        </div>

        <Link
          to="/inventario?filter=criticos"
          className="p-4 rounded-2xl bg-cd border border-[var(--bd)] hover:border-[var(--ac)] transition-colors block col-span-2 md:col-span-1"
        >
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">
            Alertas Stock Bajo
          </span>
          <div className="text-2xl font-black mt-1 text-rose-500">{catalogStats.stockBajo}</div>
          <span className="text-[10px] text-[var(--ac)] font-bold mt-1 inline-flex items-center gap-1">
            Ver en Inventario →
          </span>
        </Link>
      </div>

      {/* Barra de Búsqueda y Filtros Visuales */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 bg-cd p-3 rounded-2xl border border-[var(--bd)]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap bg-sf p-1 rounded-xl gap-1">
            {(
              [
                ['activos', `Activos (${catalogStats.activos})`],
                ['todd', `Bot Todd (${catalogStats.toddReady})`],
                ['stock_bajo', `Stock Bajo (${catalogStats.stockBajo})`]
              ] as [CatalogFilter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setCatalogFilter(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  catalogFilter === id
                    ? 'bg-cd shadow-sm text-[var(--tx)]'
                    : 'text-[var(--mu)] hover:text-[var(--tx)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {catalogStats.pausados > 0 && (
            <button
              onClick={() => setCatalogFilter(catalogFilter === 'pausados' ? 'activos' : 'pausados')}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-colors whitespace-nowrap ${
                catalogFilter === 'pausados'
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400'
                  : 'bg-sf border-[var(--bd)] tx-mu hover:text-[var(--tx)]'
              }`}
              title="Ver productos pausados para reactivarlos"
            >
              Pausados ({catalogStats.pausados})
            </button>
          )}
        </div>

        <div className="relative flex-1 md:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 tx-mu" />
          <input
            type="text"
            placeholder="Buscar por nombre, SKU o categoría..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-7 py-1.5 bg-sf border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-[var(--ac)]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 tx-mu hover:text-[var(--tx)]"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Controles Globales de Bot Todd (Venta sin Stock y Privacidad de Unidades) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 bg-cd p-3.5 rounded-2xl border border-[var(--bd)]">
        <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-sf border border-[var(--bd)]">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-purple-500/15 text-purple-500 shrink-0 mt-0.5">
              <PackageCheck size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-[var(--tx)]">Vender productos sin stock (Global)</span>
                {!toddSettings.allowBackorderGlobal && toddSettings.backorderSkus.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/25">
                    {toddSettings.backorderSkus.length} por producto
                  </span>
                )}
              </div>
              <p className="text-[11px] tx-mu mt-0.5 leading-snug">
                Permite que Todd siga vendiendo y cerrando pedidos aunque el producto o variante esté en 0 uds, sin pausar el bot.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={savingToddSettings}
            onClick={handleToggleGlobalBackorder}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-colors border ${
              toddSettings.allowBackorderGlobal
                ? 'bg-purple-600 text-white border-purple-500 shadow-sm'
                : 'bg-cd border-[var(--bd)] tx-mu hover:text-[var(--tx)]'
            }`}
          >
            {toddSettings.allowBackorderGlobal ? '✓ Activo Global' : 'Solo por SKU'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-sf border border-[var(--bd)]">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-500 shrink-0 mt-0.5">
              <EyeOff size={16} />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-[var(--tx)] block">
                Ocultar unidades disponibles al cliente
              </span>
              <p className="text-[11px] tx-mu mt-0.5 leading-snug">
                Todd confirma disponibilidad, colores y tallas, pero nunca revela cuántas unidades exactas quedan en bodega.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={savingToddSettings}
            onClick={handleToggleHideExactStockCounts}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-colors border ${
              toddSettings.hideExactStockCounts
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                : 'bg-cd border-[var(--bd)] tx-mu hover:text-[var(--tx)]'
            }`}
          >
            {toddSettings.hideExactStockCounts ? '✓ Oculto' : 'Visible'}
          </button>
        </div>
      </div>

      {/* GRID VISUAL DEL CATÁLOGO */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {loadingNative && filteredCatalog.length === 0 && (
          <div className="col-span-full text-center p-8 tx-mu">Cargando catálogo visual...</div>
        )}
        {!loadingNative && filteredCatalog.length === 0 && (
          <div className="col-span-full text-center p-10 tx-mu bg-cd rounded-2xl border border-[var(--bd)] space-y-3">
            <div className="text-3xl">📦</div>
            <div className="font-bold text-sm text-[var(--tx)]">No hay productos con estos filtros</div>
            <p className="text-xs max-w-md mx-auto">
              Crea un producto nuevo haciendo clic en <strong>+ Nuevo Producto</strong> o limpia el filtro actual.
            </p>
            <button
              onClick={() => setShowProductoModal(true)}
              className="px-4 py-2 bg-[var(--ac)] text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
            >
              <Plus size={14} /> Crear Producto
            </button>
          </div>
        )}
        {filteredCatalog.map(item => {
          const hasToddPitch = Boolean(item.todd_pitch);
          const margin = item.precio_venta > 0 ? item.precio_venta - item.costo_unitario : null;

          return (
            <div
              key={item.key}
              onClick={() => handleOpenItem(item)}
              className={`bg-cd border border-[var(--bd)] rounded-2xl p-3 flex flex-col justify-between cursor-pointer hover:border-[var(--ac)] hover:shadow-md transition-all group relative ${
                !item.activo ? 'opacity-70' : ''
              }`}
            >
              <div>
                <div className="aspect-square bg-sf rounded-xl overflow-hidden relative flex items-center justify-center">
                  <ProductImg
                    src={item.image_url}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />

                  {/* Badge de Disponibilidad */}
                  <div className="absolute top-2 right-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shadow-sm ${
                        item.stock_disponible <= 0
                          ? 'bg-rose-500/90 text-white border-rose-600'
                          : item.stock_disponible <= item.stock_minimo_alerta
                          ? 'bg-amber-500/90 text-white border-amber-600'
                          : 'bg-emerald-500/90 text-white border-emerald-600'
                      }`}
                    >
                      {item.stock_disponible} disp.
                    </span>
                  </div>

                  {/* Badge de Todd Bot, Video How-To y Venta Bajo Pedido */}
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-1 pointer-events-none">
                    <div className="flex items-center gap-1">
                      {hasToddPitch && (
                        <span
                          className="p-1 rounded-md bg-purple-600 text-white text-[10px] font-bold shadow flex items-center gap-0.5"
                          title="Entrenado para Bot Todd (WhatsApp)"
                        >
                          <Bot size={11} />
                        </span>
                      )}
                      {toddSettings.productVideos[item.sku.toUpperCase()] && (
                        <span
                          className="p-1 rounded-md bg-rose-600 text-white text-[10px] font-bold shadow flex items-center gap-0.5"
                          title="Tiene video How-To de YouTube vinculado"
                        >
                          <Video size={11} />
                        </span>
                      )}
                    </div>
                    {item.stock_disponible <= 0 &&
                      (toddSettings.allowBackorderGlobal || backorderSkuSet.has(item.sku.toUpperCase())) && (
                        <span
                          className="px-1.5 py-0.5 rounded-md bg-purple-600/95 text-white text-[9px] font-bold shadow border border-purple-400/50"
                          title="Bot Todd puede vender este producto aunque esté en 0 uds"
                        >
                          Bajo pedido
                        </span>
                      )}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-[10px] mono tx-mu">
                    <span className="truncate font-semibold">{item.sku}</span>
                    {!item.activo && (
                      <span className="text-rose-500 font-bold uppercase text-[9px]">Pausado</span>
                    )}
                  </div>
                  <div className="font-bold text-xs line-clamp-2 leading-snug mt-0.5 text-[var(--tx)]">
                    {item.nombre}
                  </div>
                  {(() => {
                    const cardVars = item.template_id ? (variantsByTemplateId.get(String(item.template_id)) || []) : [];
                    if (cardVars.length === 0) return null;
                    return (
                      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                        {cardVars.slice(0, 4).map(cv => (
                          <span
                            key={cv.variante_id}
                            title={`${cv.color}${cv.talla && cv.talla !== 'Única' ? ` (${cv.talla})` : ''}: ${cv.stock} uds`}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sf border border-[var(--bd)] text-[9px] text-[var(--tx)]"
                          >
                            <span
                              className="w-2 h-2 rounded-full border border-black/20 shrink-0"
                              style={{ backgroundColor: getColorHex(cv.color) }}
                            />
                            <span className="truncate max-w-[48px]">{cv.color}</span>
                            <span className="font-mono opacity-60">{cv.stock}</span>
                          </span>
                        ))}
                        {cardVars.length > 4 && (
                          <span className="text-[9px] tx-mu font-semibold">+{cardVars.length - 4}</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="mt-3 pt-2 border-t border-[var(--bd)] flex items-center justify-between text-[11px]">
                <div>
                  <span className="font-mono font-bold text-[var(--tx)] block">
                    {item.precio_venta > 0 ? `$${item.precio_venta.toFixed(2)}` : 'Sin precio'}
                  </span>
                  {margin !== null && item.costo_unitario > 0 && (
                    <span className="text-[9px] text-emerald-500 font-mono font-semibold">
                      +${margin.toFixed(2)} margen
                    </span>
                  )}
                </div>
                <span className="text-[var(--ac)] font-bold group-hover:underline">
                  Editar ficha →
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* DRAWER LATERAL: FICHA COMERCIAL, FOTOS, VARIANTES Y BOT TODD */}
      {selectedItem && (
        <>
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity"
            onClick={() => setSelectedItem(null)}
          />
          <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[500px] bg-cd z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header del Drawer */}
            <div className="p-4 border-b border-[var(--bd)] flex justify-between items-center bg-sf">
              <div className="min-w-0">
                <span className="text-[10px] font-mono tx-mu uppercase">SKU: {selectedItem.sku}</span>
                <h2 className="font-black text-sm truncate max-w-[360px] text-[var(--tx)]">
                  {editNombre || 'Sin nombre'}
                </h2>
              </div>
              <button onClick={() => setSelectedItem(null)} className="p-1.5 hover:bg-black/10 rounded-lg">
                <X size={18} />
              </button>
            </div>

            {/* Pestañas del Drawer */}
            <div className="flex bg-sf/50 border-b border-[var(--bd)] p-1 text-xs">
              <button
                onClick={() => setDrawerTab('info')}
                className={`flex-1 py-2 font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                  drawerTab === 'info' ? 'bg-cd shadow-sm text-[var(--tx)]' : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                <Package size={14} /> General & Foto
              </button>
              <button
                onClick={() => setDrawerTab('todd')}
                className={`flex-1 py-2 font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                  drawerTab === 'todd'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-purple-600 dark:text-purple-400 hover:bg-purple-500/10'
                }`}
              >
                <Bot size={14} /> Bot Todd
              </button>
              <button
                onClick={() => setDrawerTab('variantes')}
                className={`flex-1 py-2 font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                  drawerTab === 'variantes' ? 'bg-cd shadow-sm text-[var(--tx)]' : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                <Layers size={14} /> Variantes ({productVariants.length})
              </button>
            </div>

            {/* Contenido del Drawer */}
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
              {/* SUB-PESTAÑA 1: GENERAL, PRECIO Y FOTO */}
              {drawerTab === 'info' && (
                <div className="space-y-4">
                  {/* Resumen de Existencia con Enlace al Módulo de Inventario */}
                  <div className="p-3.5 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 flex items-center justify-between gap-3">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block">
                        Existencia en Bodega
                      </span>
                      <div className="text-xs mt-0.5 text-[var(--tx)]">
                        <strong className="font-mono text-sm">{selectedItem.stock_disponible}</strong> disponibles ·{' '}
                        <span className="tx-mu font-mono">
                          {selectedItem.stock_fisico} físico / {selectedItem.stock_reservado} res.
                        </span>
                      </div>
                    </div>
                    <Link
                      to={`/inventario?sku=${encodeURIComponent(selectedItem.sku)}`}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[11px] font-bold flex items-center gap-1 shrink-0 transition-colors"
                    >
                      <Boxes size={13} /> Ajustar Stock →
                    </Link>
                  </div>

                  {/* Foto del Producto */}
                  <div className="p-4 bg-sf rounded-2xl border border-[var(--bd)] flex flex-col sm:flex-row items-center gap-4">
                    <div className="w-24 h-24 rounded-2xl bg-cd border border-[var(--bd)] overflow-hidden shrink-0 relative shadow-inner flex items-center justify-center">
                      <ProductImg src={editImageUrl} className="w-full h-full object-cover" />
                      {isUploadingPhoto && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-xs font-bold">
                          Optimizando...
                        </div>
                      )}
                    </div>

                    <div className="flex-1 space-y-2 w-full text-center sm:text-left">
                      <span className="text-xs font-bold block text-[var(--tx)]">Foto del Producto</span>
                      <div className="flex flex-wrap gap-2 pt-1 justify-center sm:justify-start">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploadingPhoto}
                          className="px-3 py-1.5 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold flex items-center gap-1.5 hover:opacity-90 shadow-sm"
                        >
                          <Upload size={14} /> {editImageUrl ? 'Cambiar Foto' : 'Subir Foto'}
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowUrlInput(!showUrlInput)}
                          className="px-3 py-1.5 border border-[var(--bd)] bg-cd hover:bg-sf rounded-xl text-xs font-semibold flex items-center gap-1.5"
                        >
                          <LinkIcon size={14} /> URL
                        </button>

                        {editImageUrl && (
                          <button
                            type="button"
                            onClick={() => setEditImageUrl('')}
                            className="px-2.5 py-1.5 text-rose-500 hover:bg-rose-500/10 rounded-xl text-xs font-semibold"
                            title="Quitar foto"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      {showUrlInput && (
                        <div className="mt-2 pt-2 border-t border-[var(--bd)]">
                          <input
                            type="url"
                            placeholder="https://ejemplo.com/foto.jpg"
                            value={editImageUrl}
                            onChange={e => setEditImageUrl(e.target.value)}
                            className="w-full p-2 bg-cd border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-[var(--ac)]"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Video How-To (YouTube) */}
                  <div className="p-4 bg-sf rounded-2xl border border-[var(--bd)] space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--tx)] flex items-center gap-1.5">
                        <Video size={14} className="text-rose-500" /> Video How-To (YouTube)
                      </span>
                      {editVideoUrl.trim() && (
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                            extractYouTubeVideoId(editVideoUrl)
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25'
                          }`}
                        >
                          {extractYouTubeVideoId(editVideoUrl) ? 'YouTube válido' : 'Enlace externo'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="url"
                        value={editVideoUrl}
                        onChange={e => setEditVideoUrl(e.target.value)}
                        placeholder="https://youtube.com/shorts/... o https://youtu.be/..."
                        className="flex-1 p-2.5 bg-cd border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-rose-500"
                      />
                      {editVideoUrl.trim() && (
                        <>
                          <a
                            href={editVideoUrl.trim()}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2.5 rounded-xl border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-bold text-[var(--tx)]"
                            title="Abrir video en YouTube"
                          >
                            <ExternalLink size={14} />
                          </a>
                          <button
                            type="button"
                            onClick={() => setEditVideoUrl('')}
                            className="p-2.5 rounded-xl text-rose-500 hover:bg-rose-500/10"
                            title="Quitar video"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>

                    {getYouTubeThumbnailUrl(editVideoUrl) && (
                      <div className="flex items-center gap-3 p-2 rounded-xl bg-cd border border-[var(--bd)]">
                        <img
                          src={getYouTubeThumbnailUrl(editVideoUrl) || ''}
                          alt="Miniatura YouTube"
                          className="w-20 h-12 rounded-lg object-cover border border-[var(--bd)] shrink-0"
                        />
                        <p className="text-[11px] tx-mu leading-snug">
                          Se enviará automáticamente como <strong>mensaje con miniatura</strong> justo después de mandar la foto del producto.
                        </p>
                      </div>
                    )}
                    {!editVideoUrl.trim() && (
                      <p className="text-[10px] tx-mu leading-snug">
                        Opcional: pega el enlace de tu canal de YouTube. Al enviar la foto por Bot Todd o UniChat, el cliente recibirá este tutorial automático.
                      </p>
                    )}
                  </div>

                  {/* Nombre y Categoría */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                        Nombre Comercial *
                      </label>
                      <input
                        type="text"
                        value={editNombre}
                        onChange={e => setEditNombre(e.target.value)}
                        placeholder="Ej. Mini Masajeador Cervical EMS"
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-medium outline-none focus:border-[var(--ac)]"
                      />
                      <span className="text-[10px] tx-mu mt-1 block">
                        Todd y los mensajes de video usan este nombre tal cual con el cliente.
                      </span>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Categoría</label>
                      <input
                        type="text"
                        value={editCategoria}
                        onChange={e => setEditCategoria(e.target.value)}
                        placeholder="General"
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-[var(--ac)]"
                      />
                    </div>
                  </div>

                  {/* Precios y Costos */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                        Precio de Venta ($)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editPrecio}
                        onChange={e => setEditPrecio(e.target.value)}
                        placeholder="25.00"
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-sm font-bold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                        Costo Referencial ($)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editCosto}
                        onChange={e => setEditCosto(e.target.value)}
                        placeholder="3.50"
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-sm font-bold outline-none"
                      />
                    </div>
                  </div>

                  {liveMargin && (
                    <div className="px-3 py-2 rounded-xl bg-sf border border-[var(--bd)] flex items-center justify-between text-xs">
                      <span className="tx-mu">Margen bruto unitario estimado:</span>
                      <span
                        className={`font-mono font-bold ${
                          liveMargin.diff >= 0 ? 'text-emerald-500' : 'text-rose-500'
                        }`}
                      >
                        ${liveMargin.diff.toFixed(2)} ({liveMargin.pct.toFixed(0)}%)
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                        Alerta Stock Mínimo
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={editStockMinimo}
                        onChange={e => setEditStockMinimo(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                        Ubicación en Bodega
                      </label>
                      <input
                        type="text"
                        value={editUbicacion}
                        onChange={e => setEditUbicacion(e.target.value)}
                        placeholder="Estante A-2"
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                      />
                    </div>
                  </div>

                  {/* Switch de Estado */}
                  <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[var(--tx)] block">Estado en Catálogo</span>
                      <span className="text-[10px] tx-mu">Activo para ventas, pedidos y Bot Todd</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditActivo(!editActivo)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                        editActivo
                          ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
                      }`}
                    >
                      {editActivo ? '✓ Activo' : '✕ Pausado'}
                    </button>
                  </div>
                </div>
              )}

              {/* SUB-PESTAÑA 2: BOT TODD */}
              {drawerTab === 'todd' && (
                <div className="space-y-4">
                  <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-2xl">
                    <div className="flex items-center gap-2">
                      <Bot className="text-purple-600 dark:text-purple-400" size={18} />
                      <h4 className="font-bold text-xs text-purple-700 dark:text-purple-300">
                        Entrenamiento de Ventas para Bot Todd
                      </h4>
                    </div>
                    <p className="text-[11px] text-purple-900/80 dark:text-purple-200/80 mt-1 leading-relaxed">
                      Todd usará esta ficha en WhatsApp y UniChat leyendo la disponibilidad real desde Inventario y Variantes (colores/tallas).
                    </p>
                  </div>

                  {/* Resumen en vivo de Variantes alimentadas a Bot Todd */}
                  <div className="p-3 rounded-xl bg-sf border border-[var(--bd)] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase font-bold tx-mu flex items-center gap-1">
                        <Layers size={12} className="text-indigo-500" /> Variantes alimentando a Todd ({productVariants.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => setDrawerTab('variantes')}
                        className="text-[10px] font-bold text-[var(--ac)] hover:underline"
                      >
                        Editar colores/tallas →
                      </button>
                    </div>
                    {productVariants.length === 0 ? (
                      <p className="text-[11px] tx-mu">
                        Sin variantes aún. Agrega colores o tallas en la pestaña <strong>Variantes</strong> para que Todd indique opciones y stock exacto.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-1.5">
                          {productVariants.map(v => (
                            <span
                              key={v.variante_id}
                              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-semibold ${
                                v.stock > 0 || isSelectedBackorderEnabled
                                  ? 'bg-cd border-[var(--bd)] text-[var(--tx)]'
                                  : 'bg-rose-500/5 border-rose-500/20 text-rose-500'
                              }`}
                            >
                              <span
                                className="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0"
                                style={{ backgroundColor: getColorHex(v.color) }}
                              />
                              {v.color}
                              {v.talla && v.talla !== 'Única' ? ` · ${v.talla}` : ''}:{' '}
                              <strong className="font-mono">{v.stock}</strong>
                            </span>
                          ))}
                        </div>
                        {toddSettings.hideExactStockCounts && (
                          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                            Privacidad activa: al cliente solo se le dirá &quot;Disponible&quot;, nunca las cantidades exactas.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[var(--tx)] block">Venta Activa por Bot Todd</span>
                      <span className="text-[10px] tx-mu">Permite que Todd ofrezca este producto</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditActivoTodd(!editActivoTodd)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                        editActivoTodd ? 'bg-purple-600 text-white shadow-sm' : 'bg-sf border border-[var(--bd)] tx-mu'
                      }`}
                    >
                      {editActivoTodd ? '✓ Habilitado' : '✕ Deshabilitado'}
                    </button>
                  </div>

                  <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold text-[var(--tx)] block">
                        Vender sin stock (Bajo pedido)
                      </span>
                      <span className="text-[10px] tx-mu block">
                        {toddSettings.allowBackorderGlobal
                          ? 'Activo automáticamente por la regla Global del catálogo.'
                          : 'Todd venderá este producto aunque tenga 0 uds sin pausar el chat.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={savingToddSettings}
                      onClick={() => handleToggleSkuBackorder(selectedItem.sku)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-colors shrink-0 ${
                        backorderSkuSet.has(selectedItem.sku.toUpperCase())
                          ? 'bg-purple-600 text-white shadow-sm'
                          : toddSettings.allowBackorderGlobal
                          ? 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30'
                          : 'bg-cd border border-[var(--bd)] tx-mu'
                      }`}
                    >
                      {backorderSkuSet.has(selectedItem.sku.toUpperCase())
                        ? '✓ Bajo pedido'
                        : toddSettings.allowBackorderGlobal
                        ? '✓ Global'
                        : 'Solo con stock'}
                    </button>
                  </div>

                  {/* Estado del Video How-To en Bot Todd */}
                  <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-[var(--tx)] flex items-center gap-1.5">
                        <Video size={13} className="text-rose-500" /> Video How-To (YouTube)
                      </span>
                      <span className="text-[10px] tx-mu block truncate mt-0.5">
                        {editVideoUrl.trim()
                          ? editVideoUrl.trim()
                          : 'Sin video asignado aún (se envía automático con la foto)'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDrawerTab('info')}
                      className="px-2.5 py-1 rounded-lg border border-[var(--bd)] bg-cd hover:border-[var(--ac)] text-[10px] font-bold shrink-0"
                    >
                      {editVideoUrl.trim() ? 'Cambiar' : '+ Agregar'}
                    </button>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold tx-mu mb-1 flex items-center gap-1.5">
                      <Sparkles size={12} className="text-purple-500" /> Pitch de Venta & Beneficios Clave
                    </label>
                    <textarea
                      rows={3}
                      value={editToddPitch}
                      onChange={e => setEditToddPitch(e.target.value)}
                      placeholder="Ej. Alivia contracturas y dolores musculares en 15 minutos..."
                      className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-purple-500 leading-relaxed resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold tx-mu mb-1 flex items-center gap-1.5">
                      <MessageSquare size={12} className="text-purple-500" /> Ofertas & Reglas del Bot (incluye variantes sincronizadas)
                    </label>
                    <textarea
                      rows={3}
                      value={editToddInstrucciones}
                      onChange={e => setEditToddInstrucciones(e.target.value)}
                      placeholder="Ej. Ofrecer promoción 2 por $25."
                      className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-purple-500 leading-relaxed resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase font-bold tx-mu mb-1 flex items-center gap-1.5">
                      <Tag size={12} className="text-purple-500" /> Sinónimos y Palabras Clave
                    </label>
                    <input
                      type="text"
                      value={editToddKeywords}
                      onChange={e => setEditToddKeywords(e.target.value)}
                      placeholder="masajeador, cuello, dolores, negro, gris"
                      className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-purple-500"
                    />
                  </div>

                  <div className="p-4 bg-sf rounded-2xl border border-[var(--bd)] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--tx)] flex items-center gap-1.5">
                        <Bot size={14} className="text-purple-500" /> Vista Previa: Respuesta de Todd
                      </span>
                      <button
                        type="button"
                        onClick={handleSimulateTodd}
                        disabled={isSimulating}
                        className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-[10px] font-bold flex items-center gap-1"
                      >
                        <Sparkles size={11} /> Probar
                      </button>
                    </div>

                    <div className="p-3 bg-emerald-950/10 dark:bg-emerald-900/20 rounded-xl border border-emerald-500/20 text-xs font-mono leading-relaxed whitespace-pre-wrap text-[var(--tx)]">
                      {simRespuesta || (
                        <span className="tx-mu italic font-sans text-[11px]">
                          Presiona "Probar" para ver cómo responderá Todd con colores, tallas y disponibilidad.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SUB-PESTAÑA 3: VARIANTES (COLORES, TALLAS Y STOCK POR VARIANTE) */}
              {drawerTab === 'variantes' && (
                <div className="space-y-4">
                  {/* Barra de Sincronización con Bodega y Bot Todd */}
                  <div className="p-3.5 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-indigo-600 dark:text-indigo-400 block">
                          Stock Total por Variantes
                        </span>
                        <div className="text-xs font-bold text-[var(--tx)] mt-0.5">
                          <span className="font-mono text-sm text-emerald-600 dark:text-emerald-400">
                            {totalVariantsStock} uds
                          </span>{' '}
                          <span className="tx-mu font-normal">en {productVariants.length} variante(s)</span>
                        </div>
                      </div>

                      {productVariants.length > 0 && (
                        <button
                          type="button"
                          disabled={isSavingVariant}
                          onClick={handleForceSyncToddVariants}
                          className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-[10px] font-bold flex items-center gap-1"
                          title="Sincronizar variantes hacia instrucciones de Bot Todd y Bodega"
                        >
                          <Bot size={12} /> Sincronizar Todd
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-3 pt-1 text-[11px]">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={syncMasterWithVariants}
                          onChange={e => setSyncMasterWithVariants(e.target.checked)}
                          className="accent-emerald-600"
                        />
                        <span>Sumar al stock de Bodega</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={syncToddWithVariants}
                          onChange={e => setSyncToddWithVariants(e.target.checked)}
                          className="accent-purple-600"
                        />
                        <span>Alimentar Bot Todd</span>
                      </label>
                    </div>
                  </div>

                  {/* Selector de Modo de Creación */}
                  <div className="p-3.5 rounded-2xl bg-sf border border-[var(--bd)] space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--tx)]">Agregar Colores / Tallas</span>
                      <div className="flex bg-cd p-0.5 rounded-lg border border-[var(--bd)] text-[10px] font-bold">
                        <button
                          type="button"
                          onClick={() => setVarMode('single')}
                          className={`px-2 py-1 rounded-md transition-colors ${
                            varMode === 'single' ? 'bg-[var(--ac)] text-white' : 'tx-mu'
                          }`}
                        >
                          + Individual
                        </button>
                        <button
                          type="button"
                          onClick={() => setVarMode('matrix')}
                          className={`px-2 py-1 rounded-md transition-colors ${
                            varMode === 'matrix' ? 'bg-[var(--ac)] text-white' : 'tx-mu'
                          }`}
                        >
                          ⚡ Matriz Rápida
                        </button>
                      </div>
                    </div>

                    {varMode === 'single' ? (
                      <form onSubmit={handleAddSingleVariant} className="space-y-3">
                        <div>
                          <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                            Color *
                          </label>
                          <div className="flex items-center gap-2">
                            <span
                              className="w-6 h-6 rounded-lg border border-[var(--bd)] shrink-0"
                              style={{ backgroundColor: getColorHex(varColor) }}
                            />
                            <input
                              type="text"
                              value={varColor}
                              onChange={e => setVarColor(e.target.value)}
                              placeholder="Ej. Gris, Negro, Azul Marino..."
                              className="flex-1 p-2 rounded-xl border border-[var(--bd)] bg-cd text-xs outline-none focus:border-[var(--ac)]"
                            />
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {QUICK_COLORS.map(c => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setVarColor(c)}
                                className={`px-1.5 py-0.5 rounded-md border text-[10px] flex items-center gap-1 transition-colors ${
                                  varColor.toLowerCase() === c.toLowerCase()
                                    ? 'border-[var(--ac)] bg-[var(--ac)]/10 font-bold'
                                    : 'border-[var(--bd)] bg-cd tx-mu hover:text-[var(--tx)]'
                                }`}
                              >
                                <span
                                  className="w-2 h-2 rounded-full border border-black/20"
                                  style={{ backgroundColor: getColorHex(c) }}
                                />
                                {c}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                            Talla / Tamaño
                          </label>
                          <input
                            type="text"
                            value={varTalla}
                            onChange={e => setVarTalla(e.target.value)}
                            placeholder="Única, S, M, L, XL..."
                            className="w-full p-2 rounded-xl border border-[var(--bd)] bg-cd text-xs outline-none focus:border-[var(--ac)]"
                          />
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {QUICK_SIZES.map(sz => (
                              <button
                                key={sz}
                                type="button"
                                onClick={() => setVarTalla(sz)}
                                className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${
                                  varTalla === sz
                                    ? 'border-[var(--ac)] bg-[var(--ac)]/10 text-[var(--ac)]'
                                    : 'border-[var(--bd)] bg-cd tx-mu hover:text-[var(--tx)]'
                                }`}
                              >
                                {sz}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                              Unidades *
                            </label>
                            <input
                              type="number"
                              min="0"
                              value={varStock}
                              onChange={e => setVarStock(e.target.value)}
                              className="w-full p-2 rounded-xl border border-[var(--bd)] bg-cd text-xs font-bold outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                              Precio ($)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={varPrecio}
                              onChange={e => setVarPrecio(e.target.value)}
                              placeholder={selectedItem.precio_venta ? String(selectedItem.precio_venta) : '15.00'}
                              className="w-full p-2 rounded-xl border border-[var(--bd)] bg-cd text-xs font-bold outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                              SKU (Opc.)
                            </label>
                            <input
                              type="text"
                              value={varCustomSku}
                              onChange={e => setVarCustomSku(e.target.value.toUpperCase())}
                              placeholder={buildVariantSku(selectedItem.sku, varColor, varTalla)}
                              className="w-full p-2 rounded-xl border border-[var(--bd)] bg-cd text-[10px] font-mono outline-none"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={isSavingVariant}
                          className="w-full py-2 bg-[var(--ac)] hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <Plus size={14} /> {isSavingVariant ? 'Guardando...' : 'Agregar Variante'}
                        </button>
                      </form>
                    ) : (
                      <form onSubmit={handleGenerateMatrixVariants} className="space-y-3">
                        <div>
                          <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                            Colores (separados por coma) *
                          </label>
                          <input
                            type="text"
                            value={matrixColores}
                            onChange={e => setMatrixColores(e.target.value)}
                            placeholder="Ej. Negro, Gris, Azul, Rosado"
                            className="w-full p-2 rounded-xl border border-[var(--bd)] bg-cd text-xs outline-none focus:border-[var(--ac)]"
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                              Tallas (coma)
                            </label>
                            <input
                              type="text"
                              value={matrixTallas}
                              onChange={e => setMatrixTallas(e.target.value)}
                              placeholder="Única o S, M, L"
                              className="w-full p-2 rounded-xl border border-[var(--bd)] bg-cd text-xs outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                              Uds c/u
                            </label>
                            <input
                              type="number"
                              min="0"
                              value={matrixStockPorVar}
                              onChange={e => setMatrixStockPorVar(e.target.value)}
                              className="w-full p-2 rounded-xl border border-[var(--bd)] bg-cd text-xs font-bold outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                              Precio ($)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={matrixPrecio}
                              onChange={e => setMatrixPrecio(e.target.value)}
                              placeholder={selectedItem.precio_venta ? String(selectedItem.precio_venta) : '15.00'}
                              className="w-full p-2 rounded-xl border border-[var(--bd)] bg-cd text-xs font-bold outline-none"
                            />
                          </div>
                        </div>
                        <button
                          type="submit"
                          disabled={isSavingVariant}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <Sparkles size={14} /> {isSavingVariant ? 'Generando...' : 'Generar Combinaciones'}
                        </button>
                      </form>
                    )}
                  </div>

                  {/* Lista Editable de Variantes Registradas */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-xs uppercase tx-mu flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Package size={14} /> Variantes Registradas ({productVariants.length})
                      </span>
                      {toddVariantsPreview.bulletLines.length > 0 && (
                        <span className="text-[10px] font-normal text-purple-500">Todd Activo ✓</span>
                      )}
                    </h4>

                    {productVariants.length === 0 ? (
                      <div className="text-xs tx-mu p-4 bg-sf rounded-xl border border-[var(--bd)] text-center">
                        Este producto aún no tiene variantes de color o talla. Agrega una arriba para dividir tu stock por color/talla y alimentar a Bot Todd.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {productVariants.map((v) => {
                          const inputVal =
                            editingVarStock[v.variante_id] !== undefined
                              ? editingVarStock[v.variante_id]
                              : String(v.stock);
                          const isDirty =
                            editingVarStock[v.variante_id] !== undefined &&
                            Number(editingVarStock[v.variante_id]) !== v.stock;

                          return (
                            <div
                              key={v.variante_id || v.sku}
                              className="p-3 bg-sf border border-[var(--bd)] rounded-xl flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0 flex items-center gap-2.5">
                                <span
                                  className="w-7 h-7 rounded-lg border border-black/20 shrink-0 shadow-inner"
                                  style={{ backgroundColor: getColorHex(v.color) }}
                                  title={v.color}
                                />
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-[var(--tx)] truncate flex items-center gap-1.5">
                                    <span>{v.color || 'Estándar'}</span>
                                    {v.talla && v.talla !== 'Única' && (
                                      <span className="px-1.5 py-0.2 rounded bg-cd border border-[var(--bd)] text-[10px] font-mono">
                                        {v.talla}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mono text-[10px] tx-mu truncate">
                                    {v.sku} · ${Number(v.precio || selectedItem.precio_venta || 0).toFixed(2)}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={isSavingVariant || v.stock <= 0}
                                  onClick={() => handleVariantStockUpdate(v, Math.max(v.stock - 1, 0))}
                                  className="w-6 h-6 rounded-lg border border-[var(--bd)] bg-cd hover:bg-black/10 disabled:opacity-40 text-xs font-bold flex items-center justify-center"
                                  title="Restar 1 unidad"
                                >
                                  −
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  value={inputVal}
                                  onChange={e =>
                                    setEditingVarStock(prev => ({
                                      ...prev,
                                      [v.variante_id]: e.target.value
                                    }))
                                  }
                                  onBlur={() => {
                                    if (isDirty) {
                                      handleVariantStockUpdate(v, parseInt(inputVal || '0', 10) || 0);
                                    }
                                  }}
                                  className="w-12 p-1 text-center rounded-lg border border-[var(--bd)] bg-cd text-xs font-mono font-bold outline-none focus:border-[var(--ac)]"
                                />
                                <button
                                  type="button"
                                  disabled={isSavingVariant}
                                  onClick={() => handleVariantStockUpdate(v, v.stock + 1)}
                                  className="w-6 h-6 rounded-lg border border-[var(--bd)] bg-cd hover:bg-black/10 disabled:opacity-40 text-xs font-bold flex items-center justify-center"
                                  title="Sumar 1 unidad"
                                >
                                  +
                                </button>
                                {isDirty && (
                                  <button
                                    type="button"
                                    disabled={isSavingVariant}
                                    onClick={() => handleVariantStockUpdate(v, parseInt(inputVal || '0', 10) || 0)}
                                    className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold"
                                  >
                                    OK
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={isSavingVariant}
                                  onClick={() => handleDeleteVariant(v)}
                                  className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                                  title="Eliminar variante"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer del Drawer */}
            <div className="p-4 border-t border-[var(--bd)] bg-sf flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setDeleteErrorBanner(null);
                  setShowDeleteModal(true);
                }}
                className="px-3 py-2 border border-rose-500/20 text-rose-600 hover:bg-rose-500/10 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <Trash2 size={14} /> Eliminar
              </button>

              <button
                type="button"
                onClick={handleSaveProductDetails}
                disabled={isSavingDetails}
                className="px-5 py-2 bg-[var(--ac)] hover:opacity-90 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm"
              >
                <Save size={14} /> {isSavingDetails ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* MODAL: CONFIRMACIÓN DE ELIMINACIÓN */}
      {showDeleteModal && selectedItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowDeleteModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2 text-rose-500">
                <Trash2 size={18} />
                <h3 className="font-bold text-sm">¿Eliminar o Desactivar Producto?</h3>
              </div>
              <button onClick={() => setShowDeleteModal(false)} className="p-1 rounded-lg hover:bg-black/10">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs leading-relaxed tx-mu">
                Producto: <strong className="text-[var(--tx)]">{selectedItem.nombre}</strong> (
                <span className="font-mono">{selectedItem.sku}</span>)
              </p>

              {deleteErrorBanner && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-300 space-y-2">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle size={14} /> Bloqueo de Supabase detectado
                  </div>
                  <p className="text-[11px] leading-relaxed">{deleteErrorBanner}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteModal(false);
                      setShowSqlModal(true);
                    }}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-lg text-[11px] font-black inline-flex items-center gap-1.5"
                  >
                    <Code size={12} /> Ver y Copiar Script SQL Sprint 10
                  </button>
                </div>
              )}

              <div className="space-y-3">
                <button
                  type="button"
                  disabled={isSavingDetails}
                  onClick={() => handleDeleteProduct(false)}
                  className="w-full text-left p-3.5 rounded-xl border border-[var(--bd)] bg-sf hover:border-amber-500/50 hover:bg-amber-500/5 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-600">⏸️ Desactivar / Pausar</span>
                    <ChevronRight size={14} className="tx-mu" />
                  </div>
                  <p className="text-[11px] tx-mu mt-1">
                    Conserva el historial de Kárdex y pedidos, pero oculta el producto de ventas y de Bot Todd.
                  </p>
                </button>

                <button
                  type="button"
                  disabled={isSavingDetails}
                  onClick={() => handleDeleteProduct(true)}
                  className="w-full text-left p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-600">🗑️ Eliminar Definitivamente de Supabase</span>
                    <ChevronRight size={14} className="text-rose-500" />
                  </div>
                  <p className="text-[11px] text-rose-600/80 dark:text-rose-400/80 mt-1">
                    Borra el producto, su stock, variantes y registros de prueba en cascada.
                  </p>
                </button>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold hover:bg-sf"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREAR PRODUCTO NUEVO */}
      {showProductoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowProductoModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <h3 className="font-bold text-sm">Crear Producto en Catálogo</h3>
              <button onClick={() => setShowProductoModal(false)} className="p-1 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveProducto} className="p-5 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                    Nombre del Producto *
                  </label>
                  <input
                    type="text"
                    value={prodNombre}
                    onChange={e => setProdNombre(e.target.value)}
                    placeholder="Ej. Porta Bebés Ergonómico"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-[var(--ac)]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Categoría</label>
                  <input
                    type="text"
                    value={prodCategoria}
                    onChange={e => setProdCategoria(e.target.value)}
                    placeholder="General"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-[var(--ac)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">SKU Único *</label>
                  <input
                    type="text"
                    value={prodSku}
                    onChange={e => setProdSku(e.target.value.toUpperCase().replace(/\s+/g, '-'))}
                    placeholder="PORTA-BEBE-01"
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs uppercase font-mono font-bold outline-none focus:border-[var(--ac)]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                    Stock Inicial en Bodega
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prodStockInicial}
                    onChange={e => setProdStockInicial(e.target.value)}
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Precio Venta ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={prodPrecio}
                    onChange={e => setProdPrecio(e.target.value)}
                    placeholder="35.00"
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Costo ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={prodCosto}
                    onChange={e => setProdCosto(e.target.value)}
                    placeholder="8.50"
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Alerta Mín.</label>
                  <input
                    type="number"
                    min="0"
                    value={prodStockMinimo}
                    onChange={e => setProdStockMinimo(e.target.value)}
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                  Imagen del Producto (Opcional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={prodImagen}
                    onChange={e => setProdImagen(e.target.value)}
                    placeholder="https://... o sube archivo →"
                    className="flex-1 p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => newProdFileInputRef.current?.click()}
                    className="px-3 py-2 border border-[var(--bd)] bg-sf hover:bg-cd rounded-xl text-xs font-bold flex items-center gap-1"
                  >
                    <Upload size={13} /> Subir
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1 flex items-center gap-1">
                  <Video size={11} className="text-rose-500" /> Video How-To YouTube (Opcional)
                </label>
                <input
                  type="url"
                  value={prodVideoUrl}
                  onChange={e => setProdVideoUrl(e.target.value)}
                  placeholder="https://youtube.com/shorts/... o https://youtu.be/..."
                  className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-rose-500"
                />
              </div>

              <div className="p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/20 space-y-2">
                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                  <Layers size={13} /> Variantes iniciales por Color / Talla (Opcional)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={prodColoresInit}
                    onChange={e => setProdColoresInit(e.target.value)}
                    placeholder="Colores: Negro, Gris, Azul"
                    className="w-full p-2 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                  />
                  <input
                    type="text"
                    value={prodTallasInit}
                    onChange={e => setProdTallasInit(e.target.value)}
                    placeholder="Tallas: Única o S, M, L"
                    className="w-full p-2 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                  />
                </div>
                {prodColoresInit.trim() && (
                  <p className="text-[10px] tx-mu">
                    Se creará cada combinación con <strong>{prodStockInicial || '0'} uds</strong> iniciales y se sincronizarán con Bot Todd y Bodega.
                  </p>
                )}
              </div>

              <div className="p-3 bg-purple-500/5 rounded-xl border border-purple-500/20 space-y-2">
                <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                  <Bot size={13} /> Preparar para Bot Todd (Opcional)
                </span>
                <input
                  type="text"
                  value={prodToddPitch}
                  onChange={e => setProdToddPitch(e.target.value)}
                  placeholder="Pitch de venta: ¿Por qué comprarlo?"
                  className="w-full p-2 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                />
                <input
                  type="text"
                  value={prodToddKeywords}
                  onChange={e => setProdToddKeywords(e.target.value)}
                  placeholder="Palabras clave: porta bebe, ergonomico, bebe"
                  className="w-full p-2 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowProductoModal(false)}
                  className="px-3.5 py-1.5 border border-[var(--bd)] rounded-xl text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingProd}
                  className="px-4 py-1.5 bg-[var(--ac)] text-white font-bold rounded-xl text-xs"
                >
                  {isSavingProd ? 'Guardando...' : 'Crear Producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: SCRIPT SQL SPRINT 10 */}
      <Sprint10SqlModal open={showSqlModal} onClose={() => setShowSqlModal(false)} />
    </div>
  );
}
