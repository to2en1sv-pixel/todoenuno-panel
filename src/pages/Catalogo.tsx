import { useState, useMemo, useEffect, useRef } from 'react';
import { useProductos, useVariantes, useInventory } from '@/hooks/useCatalog';
import { 
  Search, 
  Package, 
  AlertTriangle, 
  X, 
  Plus, 
  ArrowDownLeft, 
  ArrowUpRight, 
  SlidersHorizontal, 
  Clock, 
  DollarSign, 
  Building, 
  Code, 
  Copy, 
  Check, 
  Sparkles, 
  Boxes, 
  Layers, 
  History,
  FileSpreadsheet,
  CheckCircle2,
  Upload,
  Image as ImageIcon,
  Trash2,
  Bot,
  MessageSquare,
  Tag,
  Save,
  Link as LinkIcon,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Send
} from 'lucide-react';
import { 
  fetchStockItems, 
  fetchKardexMovements, 
  recordStockEntry, 
  adjustStock, 
  saveProductItem,
  compressImageFile,
  updateProductDetails,
  deleteProductItem,
  getToddProductConfig
} from '@/lib/inventory';
import type { 
  StockItem, 
  KardexMovement, 
  EntradaMercaderiaFormData, 
  ProductFormData 
} from '@/types/inventory';

const SPRINT3_SQL_CODE = `-- ============================================================================
-- TODOENUNO OS — SPRINT 3: INVENTARIO NATIVO & KÁRDEX ENGINE (DESACOPLE DE ODOO)
-- Ejecutar en: Supabase SQL Editor
-- ============================================================================

create schema if not exists inventory;

create table if not exists inventory.stock (
  sku                 text primary key,
  nombre              text not null default 'Producto',
  template_id         text,
  stock_fisico        integer not null default 0 check (stock_fisico >= 0),
  stock_reservado     integer not null default 0 check (stock_reservado >= 0),
  stock_disponible    integer generated always as (greatest(stock_fisico - stock_reservado, 0)) stored,
  costo_unitario      numeric(10,2) not null default 0.00 check (costo_unitario >= 0),
  precio_venta        numeric(10,2) not null default 0.00 check (precio_venta >= 0),
  stock_minimo_alerta integer not null default 5 check (stock_minimo_alerta >= 0),
  ubicacion           text not null default 'Bodega Central',
  activo              boolean not null default true,
  image_url           text,
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create table if not exists inventory.kardex (
  id               bigint generated always as identity primary key,
  sku              text not null references inventory.stock(sku) on update cascade,
  tipo_movimiento  text not null check (tipo_movimiento in (
    'compra_entrada', 'venta_salida', 'reserva_pedido', 'devolucion_entrada', 'ajuste_positivo', 'ajuste_negativo', 'merma_dano'
  )),
  cantidad         integer not null,
  costo_unitario   numeric(10,2) not null default 0.00,
  saldo_fisico     integer not null,
  motivo           text not null,
  source_table     text,
  source_id        text,
  usuario          text default 'Sistema',
  created_at       timestamptz not null default now()
);

-- Migración inicial desde inventory_cache y productos_variantes (con agrupación anti-duplicados)
do $$
begin
  if exists (select from pg_tables where schemaname = 'public' and tablename = 'inventory_cache') then
    insert into inventory.stock (sku, nombre, stock_fisico, updated_at)
    select 
      ic.sku,
      coalesce(max(p.nombre_base), ic.sku) as nombre,
      greatest(sum(coalesce(ic.qty, 0)), 0) as stock_fisico,
      now()
    from public.inventory_cache ic
    left join public.productos_variantes pv on pv.sku = ic.sku
    left join public.productos p on p.template_id = pv.template_id
    where ic.sku is not null and trim(ic.sku) <> ''
    group by ic.sku
    on conflict (sku) do update set
      stock_fisico = excluded.stock_fisico,
      nombre = coalesce(inventory.stock.nombre, excluded.nombre);
  end if;
end;
$$;

create or replace function inventory.record_movement(
  p_sku             text,
  p_tipo_movimiento text,
  p_cantidad        integer,
  p_costo_unitario  numeric default 0.00,
  p_motivo          text default '',
  p_source_table    text default 'manual',
  p_source_id       text default null,
  p_usuario         text default 'Panel Admin'
) returns jsonb language plpgsql security definer as $$
declare
  v_stock_actual integer;
  v_reservado_actual integer;
  v_nuevo_fisico integer;
  v_nuevo_reservado integer;
  v_kardex_id bigint;
begin
  insert into inventory.stock (sku, nombre, stock_fisico, created_at)
  values (p_sku, p_sku, 0, now()) on conflict (sku) do nothing;

  select stock_fisico, stock_reservado
    into v_stock_actual, v_reservado_actual
    from inventory.stock where sku = p_sku for update;

  v_nuevo_fisico    := v_stock_actual;
  v_nuevo_reservado := v_reservado_actual;

  if p_tipo_movimiento in ('compra_entrada', 'ajuste_positivo') then
    v_nuevo_fisico := v_stock_actual + abs(p_cantidad);
    if p_tipo_movimiento = 'compra_entrada' and p_costo_unitario > 0 then
      update inventory.stock set costo_unitario = p_costo_unitario where sku = p_sku;
    end if;
  elsif p_tipo_movimiento = 'reserva_pedido' then
    v_nuevo_reservado := v_reservado_actual + abs(p_cantidad);
  elsif p_tipo_movimiento = 'venta_salida' then
    v_nuevo_fisico    := greatest(v_stock_actual - abs(p_cantidad), 0);
    v_nuevo_reservado := greatest(v_reservado_actual - abs(p_cantidad), 0);
  elsif p_tipo_movimiento in ('ajuste_negativo', 'merma_dano') then
    v_nuevo_fisico := greatest(v_stock_actual - abs(p_cantidad), 0);
  elsif p_tipo_movimiento = 'devolucion_entrada' then
    v_nuevo_reservado := greatest(v_reservado_actual - abs(p_cantidad), 0);
    v_nuevo_fisico    := v_stock_actual + abs(p_cantidad);
  end if;

  update inventory.stock
     set stock_fisico = v_nuevo_fisico, stock_reservado = v_nuevo_reservado, updated_at = now()
   where sku = p_sku;

  insert into inventory.kardex (
    sku, tipo_movimiento, cantidad, costo_unitario, saldo_fisico, motivo, source_table, source_id, usuario
  ) values (
    p_sku, p_tipo_movimiento, p_cantidad, coalesce(p_costo_unitario, 0.00),
    v_nuevo_fisico, p_motivo, p_source_table, p_source_id, p_usuario
  ) returning id into v_kardex_id;

  return jsonb_build_object('success', true, 'kardex_id', v_kardex_id);
end;
$$;

create or replace view public.inventory_stock as select * from inventory.stock;
create or replace view public.inventory_kardex as select * from inventory.kardex;

alter table inventory.stock  enable row level security;
alter table inventory.kardex enable row level security;

grant usage on schema inventory to anon, authenticated, service_role;
grant select, insert, update on inventory.stock to anon, authenticated, service_role;
grant select, insert on inventory.kardex to anon, authenticated, service_role;
grant select, insert, update on public.inventory_stock to anon, authenticated, service_role;
grant select, insert on public.inventory_kardex to anon, authenticated, service_role;

create policy "inventory_stock_all"  on inventory.stock  for all using (true) with check (true);
create policy "inventory_kardex_all" on inventory.kardex for all using (true) with check (true);
grant execute on function inventory.record_movement to anon, authenticated, service_role;

-- Extensión opcional para Bot Todd (WhatsApp / UniChat)
alter table if exists public.productos 
  add column if not exists todd_pitch text default '',
  add column if not exists todd_instrucciones text default '',
  add column if not exists todd_keywords text default '',
  add column if not exists activo_todd boolean default true;
`;

/**
 * Componente de Imagen a prueba de balas
 * Descarta URLs relativas de Odoo local que dan 404 y previene iconos rotos del navegador
 */
function ProductImg({ 
  src, 
  alt = '', 
  className = '', 
  fallbackClassName = '' 
}: { 
  src?: string | null; 
  alt?: string; 
  className?: string; 
  fallbackClassName?: string;
}) {
  const [hasError, setHasError] = useState(false);

  const isValidSrc = useMemo(() => {
    if (!src || typeof src !== 'string') return false;
    const clean = src.trim();
    if (!clean) return false;
    if (clean.startsWith('/web/image') || clean.includes('localhost') || clean.startsWith('/web/content')) {
      return false;
    }
    return true;
  }, [src]);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!isValidSrc || hasError) {
    return (
      <div className={`flex flex-col items-center justify-center text-3xl bg-gradient-to-br from-sf to-cd select-none ${fallbackClassName || className || 'w-full h-full'}`}>
        <span className="text-2xl">📦</span>
        <span className="text-[9px] font-mono tx-mu mt-1">Sin imagen</span>
      </div>
    );
  }

  return (
    <img
      src={src!}
      alt=""
      className={className}
      onError={() => setHasError(true)}
      loading="lazy"
    />
  );
}

export function CatalogoPage() {
  const productos = useProductos();
  const variantes = useVariantes();
  const inv = useInventory();

  const [tab, setTab] = useState<'productos' | 'inventario' | 'kardex'>('productos');
  const [search, setSearch] = useState('');
  const [filterStock, setFilterStock] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // Pestaña interna del Drawer de Producto
  const [drawerTab, setDrawerTab] = useState<'info' | 'todd' | 'variantes'>('info');

  // Datos nativos de inventario y kárdex
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [kardexList, setKardexList] = useState<KardexMovement[]>([]);
  const [loadingNative, setLoadingNative] = useState(true);

  // Modales
  const [showEntradaModal, setShowEntradaModal] = useState(false);
  const [showAjusteModal, setShowAjusteModal] = useState(false);
  const [showProductoModal, setShowProductoModal] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Edición de Producto Seleccionado
  const [editNombre, setEditNombre] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editPrecio, setEditPrecio] = useState('');
  const [editCosto, setEditCosto] = useState('');
  const [editActivo, setEditActivo] = useState(true);
  const [editToddPitch, setEditToddPitch] = useState('');
  const [editToddInstrucciones, setEditToddInstrucciones] = useState('');
  const [editToddKeywords, setEditToddKeywords] = useState('');
  const [editActivoTodd, setEditActivoTodd] = useState(true);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);

  // Simulador de Todd Bot en el Drawer
  const [simPregunta, setSimPregunta] = useState('');
  const [simRespuesta, setSimRespuesta] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);

  // Formulario Entrada de Mercadería
  const [entradaSku, setEntradaSku] = useState('');
  const [entradaCantidad, setEntradaCantidad] = useState('');
  const [entradaCosto, setEntradaCosto] = useState('');
  const [entradaProveedor, setEntradaProveedor] = useState('');
  const [entradaNotas, setEntradaNotas] = useState('');
  const [entradaAsentarFinanzas, setEntradaAsentarFinanzas] = useState(true);
  const [isSavingEntrada, setIsSavingEntrada] = useState(false);

  // Formulario Ajuste
  const [ajusteSku, setAjusteSku] = useState('');
  const [ajusteNuevoStock, setAjusteNuevoStock] = useState('');
  const [ajusteMotivo, setAjusteMotivo] = useState('Conteo físico periódico');
  const [isSavingAjuste, setIsSavingAjuste] = useState(false);

  // Formulario Nuevo Producto
  const [prodNombre, setProdNombre] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodPrecio, setProdPrecio] = useState('');
  const [prodCosto, setProdCosto] = useState('');
  const [prodStockInicial, setProdStockInicial] = useState('0');
  const [prodImagen, setProdImagen] = useState('');
  const [prodToddPitch, setProdToddPitch] = useState('');
  const [prodToddKeywords, setProdToddKeywords] = useState('');
  const [isSavingProd, setIsSavingProd] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadNativeInventory = async () => {
    setLoadingNative(true);
    const [stockRes, kardexRes] = await Promise.all([
      fetchStockItems(),
      fetchKardexMovements()
    ]);
    setStockItems(stockRes.items);
    setKardexList(kardexRes.movements);
    setLoadingNative(false);
  };

  useEffect(() => {
    loadNativeInventory();
  }, []);

  // Sincronizar formulario del Drawer cuando se selecciona un producto
  useEffect(() => {
    if (selectedProduct) {
      setEditNombre(selectedProduct.nombre_base || '');
      setEditImageUrl(selectedProduct.image_url || '');
      setEditActivo(selectedProduct.active !== false);

      // Buscar stock y costos asociados
      const itemStock = stockItems.find(s => 
        String(s.template_id) === String(selectedProduct.template_id) || 
        s.sku === String(selectedProduct.template_id)
      );
      setEditPrecio(itemStock?.precio_venta ? String(itemStock.precio_venta) : '');
      setEditCosto(itemStock?.costo_unitario ? String(itemStock.costo_unitario) : '');

      // Cargar configuración de Todd
      const todd = getToddProductConfig(selectedProduct.template_id);
      setEditToddPitch(selectedProduct.todd_pitch || todd.todd_pitch || '');
      setEditToddInstrucciones(selectedProduct.todd_instrucciones || todd.todd_instrucciones || '');
      setEditToddKeywords(selectedProduct.todd_keywords || todd.todd_keywords || '');
      setEditActivoTodd(selectedProduct.activo_todd !== undefined ? selectedProduct.activo_todd : todd.activo_todd);
      
      setDrawerTab('info');
      setSaveSuccessMsg(false);
      setSimRespuesta('');
      setShowUrlInput(false);
    }
  }, [selectedProduct, stockItems]);

  // 1. FILTRO DE PRODUCTOS
  const filteredProductos = useMemo(() => {
    let list = productos.data ?? [];
    
    // Filtro Anti-FEE
    list = list.filter(p => {
      const nombre = (p.nombre_base || '').toLowerCase();
      return !nombre.includes('fee') && !nombre.includes('servicio') && !nombre.includes('envio');
    });
    
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => 
        (p.nombre_base || '').toLowerCase().includes(q) || 
        String(p.template_id).toLowerCase().includes(q)
      );
    }
    
    if (filterStock) {
      const lowStockSkus = new Set(stockItems.filter(i => i.stock_disponible <= 5).map(i => i.sku));
      const productosConAlerta = new Set(
        variantes.data?.filter(v => v.sku && lowStockSkus.has(v.sku)).map(v => v.template_id)
      );
      list = list.filter(p => productosConAlerta.has(p.template_id));
    }
    
    return list;
  }, [productos.data, variantes.data, stockItems, search, filterStock]);

  // 2. FILTRO DE INVENTARIO NATIVO
  const filteredInventory = useMemo(() => {
    let list = stockItems;

    // Filtro Anti-FEE
    list = list.filter(i => !i.sku.toLowerCase().includes('fee'));

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => 
        i.sku.toLowerCase().includes(q) || 
        i.nombre.toLowerCase().includes(q)
      );
    }
    if (filterStock) {
      list = list.filter(i => i.stock_disponible <= (i.stock_minimo_alerta || 5));
    }
    return list;
  }, [stockItems, search, filterStock]);

  // 3. FILTRO DE KÁRDEX
  const filteredKardex = useMemo(() => {
    if (!search) return kardexList;
    const q = search.toLowerCase();
    return kardexList.filter(k => 
      k.sku.toLowerCase().includes(q) || 
      k.motivo.toLowerCase().includes(q) ||
      k.tipo_movimiento.toLowerCase().includes(q)
    );
  }, [kardexList, search]);

  // KPIs de Inventario
  const metrics = useMemo(() => {
    let totalFisico = 0;
    let totalReservado = 0;
    let totalDisponible = 0;
    let valorizacionTotal = 0;
    let skusCriticos = 0;

    stockItems.forEach(item => {
      totalFisico += item.stock_fisico || 0;
      totalReservado += item.stock_reservado || 0;
      totalDisponible += item.stock_disponible || 0;
      valorizacionTotal += (item.stock_fisico || 0) * (item.costo_unitario || 0);
      if (item.stock_disponible <= (item.stock_minimo_alerta || 5)) {
        skusCriticos++;
      }
    });

    return { totalFisico, totalReservado, totalDisponible, valorizacionTotal, skusCriticos };
  }, [stockItems]);

  // Variantes del producto seleccionado
  const productVariants = useMemo(() => {
    if (!selectedProduct) return [];
    return (variantes.data ?? []).filter(v => String(v.template_id) === String(selectedProduct.template_id));
  }, [variantes.data, selectedProduct]);

  // Subir foto desde el explorador de archivos (PC o Móvil) con compresión instantánea
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingPhoto(true);
      const compressedDataUrl = await compressImageFile(file, 800, 800, 0.82);
      setEditImageUrl(compressedDataUrl);

      if (selectedProduct) {
        // Auto-guardar la foto de inmediato para conveniencia del usuario
        await updateProductDetails({
          template_id: selectedProduct.template_id,
          image_url: compressedDataUrl
        });

        // Actualizar en el estado de selectedProduct
        setSelectedProduct((prev: any) => ({ ...prev, image_url: compressedDataUrl }));
        await productos.refetch();
        await loadNativeInventory();
      }
    } catch (err) {
      console.error('Error al subir imagen:', err);
    } finally {
      setIsUploadingPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

  // Guardar Cambios del Producto Seleccionado
  const handleSaveProductDetails = async () => {
    if (!selectedProduct) return;
    setIsSavingDetails(true);

    try {
      await updateProductDetails({
        template_id: selectedProduct.template_id,
        nombre_base: editNombre.trim(),
        image_url: editImageUrl.trim() || null,
        active: editActivo,
        precio_venta: parseFloat(editPrecio || '0'),
        costo_unitario: parseFloat(editCosto || '0'),
        todd_pitch: editToddPitch.trim(),
        todd_instrucciones: editToddInstrucciones.trim(),
        todd_keywords: editToddKeywords.trim(),
        activo_todd: editActivoTodd
      });

      setSelectedProduct((prev: any) => ({
        ...prev,
        nombre_base: editNombre.trim(),
        image_url: editImageUrl.trim() || null,
        active: editActivo,
        todd_pitch: editToddPitch.trim(),
        todd_instrucciones: editToddInstrucciones.trim(),
        todd_keywords: editToddKeywords.trim(),
        activo_todd: editActivoTodd
      }));

      setSaveSuccessMsg(true);
      setTimeout(() => setSaveSuccessMsg(false), 2500);

      await productos.refetch();
      await loadNativeInventory();
    } catch (err) {
      console.error('Error al guardar producto:', err);
    } finally {
      setIsSavingDetails(false);
    }
  };

  // Eliminar o Desactivar Producto
  const handleDeleteProduct = async (hardDelete: boolean) => {
    if (!selectedProduct) return;
    setIsSavingDetails(true);

    await deleteProductItem(selectedProduct.template_id, hardDelete);

    setIsSavingDetails(false);
    setShowDeleteModal(false);
    setSelectedProduct(null);

    await productos.refetch();
    await variantes.refetch();
    await loadNativeInventory();
  };

  // Simular respuesta del Bot Todd
  const handleSimulateTodd = () => {
    if (!selectedProduct) return;
    setIsSimulating(true);

    const question = simPregunta.trim() || '¿Qué precio tiene y qué incluye?';
    const pitch = editToddPitch || 'Es un producto de alta calidad disponible para entrega inmediata.';
    const reglas = editToddInstrucciones ? `\n(Regla del bot: ${editToddInstrucciones})` : '';
    const precio = editPrecio ? `$${parseFloat(editPrecio).toFixed(2)}` : '$25.00';

    setTimeout(() => {
      setSimRespuesta(
        `¡Hola! 👋 Gracias por consultar por el *${editNombre || selectedProduct.nombre_base}*.\n\n` +
        `${pitch}\n\n` +
        `💰 *Precio especial:* ${precio} USD con pago contra entrega en todo El Salvador 🇸🇻.\n` +
        `📦 *Disponibilidad:* Tenemos stock en bodega listo para envío en 24-48 horas.${reglas}\n\n` +
        `¿Te gustaría que te tomemos los datos de envío ahora mismo? 📲`
      );
      setIsSimulating(false);
    }, 400);
  };

  // Manejo de Entrada de Mercadería (Compra)
  const handleSaveEntrada = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entradaSku || !entradaCantidad) return;
    setIsSavingEntrada(true);

    await recordStockEntry({
      sku: entradaSku.toUpperCase().trim(),
      cantidad: parseInt(entradaCantidad),
      costo_unitario: parseFloat(entradaCosto || '0'),
      proveedor: entradaProveedor,
      notas: entradaNotas,
      asentar_en_finanzas: entradaAsentarFinanzas,
      cuenta_finanzas_id: 'banco_principal'
    });

    setIsSavingEntrada(false);
    setShowEntradaModal(false);
    setEntradaSku('');
    setEntradaCantidad('');
    setEntradaCosto('');
    setEntradaProveedor('');
    setEntradaNotas('');
    await loadNativeInventory();
  };

  // Manejo de Ajuste de Stock
  const handleSaveAjuste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ajusteSku || ajusteNuevoStock === '') return;
    setIsSavingAjuste(true);

    await adjustStock({
      sku: ajusteSku,
      nuevo_stock: parseInt(ajusteNuevoStock),
      motivo: ajusteMotivo
    });

    setIsSavingAjuste(false);
    setShowAjusteModal(false);
    setAjusteSku('');
    setAjusteNuevoStock('');
    await loadNativeInventory();
  };

  // Manejo de Crear Producto
  const handleSaveProducto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodNombre || !prodSku) return;
    setIsSavingProd(true);

    await saveProductItem({
      nombre: prodNombre,
      sku: prodSku.toUpperCase().trim(),
      precio_venta: parseFloat(prodPrecio || '0'),
      costo_unitario: parseFloat(prodCosto || '0'),
      stock_inicial: parseInt(prodStockInicial || '0'),
      stock_minimo: 5,
      image_url: prodImagen || undefined,
      todd_pitch: prodToddPitch || undefined,
      todd_keywords: prodToddKeywords || undefined
    });

    setIsSavingProd(false);
    setShowProductoModal(false);
    setProdNombre('');
    setProdSku('');
    setProdPrecio('');
    setProdCosto('');
    setProdStockInicial('0');
    setProdImagen('');
    setProdToddPitch('');
    setProdToddKeywords('');
    await productos.refetch();
    await loadNativeInventory();
  };

  const copySql = () => {
    navigator.clipboard.writeText(SPRINT3_SQL_CODE);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const getTipoBadge = (tipo: string) => {
    switch (tipo) {
      case 'compra_entrada':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">📦 Entrada Compra</span>;
      case 'venta_salida':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">🚚 Venta Entregada</span>;
      case 'reserva_pedido':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">⏳ Reserva Pedido</span>;
      case 'devolucion_entrada':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">↩️ Devolución Bodega</span>;
      case 'ajuste_positivo':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/10 text-teal-600 border border-teal-500/20">➕ Ajuste Conteo (+)</span>;
      case 'ajuste_negativo':
      case 'merma_dano':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20">⚠️ Merma / Ajuste (-)</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-sf tx-mu">{tipo}</span>;
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5 pb-14 h-full">
      {/* Input de archivo oculto para subir fotos desde cualquier dispositivo */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        accept="image/*" 
        className="hidden" 
      />

      {/* Encabezado Principal */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="text-[var(--ac)]" size={24} />
            <h1 className="text-2xl font-black">Catálogo & Inventario Nativo</h1>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              Sprint 3 Core
            </span>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30 flex items-center gap-1">
              <Bot size={12} /> Todd Ready
            </span>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1">
            Gestión de stock físico, Kárdex inmutable, carga de fotos y preparación de catálogo para el Bot de WhatsApp Todd.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setShowEntradaModal(true)}
            className="flex-1 sm:flex-none px-3.5 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:opacity-90 shadow-sm"
          >
            <ArrowDownLeft size={15} /> + Entrada Mercadería
          </button>

          <button
            onClick={() => setShowProductoModal(true)}
            className="px-3.5 py-2 border border-[var(--bd)] bg-sf hover:bg-cd rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <Plus size={14} /> Nuevo Producto
          </button>

          <button
            onClick={() => setShowSqlModal(true)}
            className="p-2 border border-[var(--bd)] rounded-xl text-xs font-bold hover:bg-sf transition-colors"
            title="Script SQL Sprint 3 & Bot Todd"
          >
            <Code size={16} />
          </button>
        </div>
      </div>

      {/* Tarjetas KPI de Inventario */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Stock Físico (Bodega)</span>
          <div className="text-2xl font-black mt-1 text-[var(--tx)]">
            {metrics.totalFisico} <span className="text-xs font-normal tx-mu">unidades</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">En {stockItems.length} SKUs registrados</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Stock Reservado</span>
          <div className="text-2xl font-black mt-1 text-amber-500">
            {metrics.totalReservado} <span className="text-xs font-normal tx-mu">en camino</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Comprometido en pedidos activos</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Stock Disponible Real</span>
          <div className="text-2xl font-black mt-1 text-emerald-500">
            {metrics.totalDisponible} <span className="text-xs font-normal tx-mu">para venta</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Físico - Reservado</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Valorización Inventario</span>
          <div className="text-2xl font-black mt-1 text-[var(--ac)]">
            ${metrics.valorizacionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Costo de mercadería en bodega</span>
        </div>
      </div>

      {/* Selector de Pestañas & Buscador */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-cd p-3 rounded-2xl border border-[var(--bd)]">
        <div className="flex bg-sf p-1 rounded-xl overflow-x-auto">
          <button 
            onClick={() => setTab('productos')} 
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              tab === 'productos' ? 'bg-cd shadow-sm text-[var(--tx)]' : 'text-[var(--mu)] hover:text-[var(--tx)]'
            }`}
          >
            <Boxes size={14} /> Catálogo Visual ({filteredProductos.length})
          </button>
          <button 
            onClick={() => setTab('inventario')} 
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              tab === 'inventario' ? 'bg-cd shadow-sm text-[var(--tx)]' : 'text-[var(--mu)] hover:text-[var(--tx)]'
            }`}
          >
            <Layers size={14} /> Control de Stock ({filteredInventory.length})
          </button>
          <button 
            onClick={() => setTab('kardex')} 
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              tab === 'kardex' ? 'bg-cd shadow-sm text-[var(--tx)]' : 'text-[var(--mu)] hover:text-[var(--tx)]'
            }`}
          >
            <History size={14} /> Kárdex de Movimientos ({filteredKardex.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 tx-mu" />
            <input 
              type="text" 
              placeholder="Buscar por SKU o producto..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-sf border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-[var(--ac)]"
            />
          </div>

          <button 
            onClick={() => setFilterStock(!filterStock)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors whitespace-nowrap ${
              filterStock 
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-600' 
                : 'bg-sf border-[var(--bd)] text-[var(--mu)] hover:bg-cd'
            }`}
          >
            <AlertTriangle size={14} /> Críticos ({metrics.skusCriticos})
          </button>
        </div>
      </div>

      {/* CONTENIDO PESTAÑA 1: CATÁLOGO VISUAL */}
      {tab === 'productos' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {productos.isLoading && <div className="col-span-full text-center p-8 tx-mu">Cargando catálogo...</div>}
          {!productos.isLoading && filteredProductos.length === 0 && (
            <div className="col-span-full text-center p-8 tx-mu bg-cd rounded-2xl border border-[var(--bd)]">
              No se encontraron productos con estos filtros.
            </div>
          )}
          {filteredProductos.map(p => {
            const variantesDeEste = (variantes.data || []).filter(v => String(v.template_id) === String(p.template_id));
            const skusDeEste = new Set(variantesDeEste.map(v => v.sku).filter(Boolean));

            let disponible = 0;
            stockItems.forEach(s => {
              if (String(s.template_id) === String(p.template_id) || (s.sku && skusDeEste.has(s.sku))) {
                disponible += Number(s.stock_disponible) || 0;
              }
            });

            if (disponible === 0 && skusDeEste.size > 0 && inv.data) {
              inv.data.forEach(i => {
                if (skusDeEste.has(i.sku)) {
                  disponible += Number(i.qty) || 0;
                }
              });
            }

            const toddCfg = getToddProductConfig(p.template_id);
            const hasToddPitch = Boolean(p.todd_pitch || toddCfg.todd_pitch);

            return (
              <div 
                key={p.template_id} 
                onClick={() => setSelectedProduct(p)}
                className="bg-cd border border-[var(--bd)] rounded-2xl p-3 flex flex-col justify-between cursor-pointer hover:border-[var(--ac)] hover:shadow-md transition-all group relative"
              >
                <div>
                  <div className="aspect-square bg-sf rounded-xl overflow-hidden relative flex items-center justify-center">
                    <ProductImg 
                      src={p.image_url} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />

                    {/* Badge de Disponibilidad */}
                    <div className="absolute top-2 right-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shadow-sm ${
                        disponible <= 0 
                          ? 'bg-rose-500/90 text-white border-rose-600' 
                          : disponible <= 5 
                          ? 'bg-amber-500/90 text-white border-amber-600' 
                          : 'bg-emerald-500/90 text-white border-emerald-600'
                      }`}>
                        {disponible} disp.
                      </span>
                    </div>

                    {/* Badge de Todd Bot */}
                    {hasToddPitch && (
                      <div className="absolute bottom-2 left-2" title="Entrenado para Bot Todd (WhatsApp)">
                        <span className="p-1 rounded-md bg-purple-600 text-white text-[10px] font-bold shadow flex items-center gap-0.5">
                          <Bot size={11} />
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] mono tx-mu">
                      <span>#{p.template_id}</span>
                      {p.active === false && (
                        <span className="text-rose-500 font-bold uppercase text-[9px]">Pausado</span>
                      )}
                    </div>
                    <div className="font-bold text-xs line-clamp-2 leading-snug mt-0.5 text-[var(--tx)]">
                      {p.nombre_base}
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-[var(--bd)] flex items-center justify-between text-[11px]">
                  <span className="text-[var(--ac)] font-bold group-hover:underline flex items-center gap-1">
                    Editar / Todd →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CONTENIDO PESTAÑA 2: CONTROL DE STOCK & DISPONIBILIDAD NATIVO */}
      {tab === 'inventario' && (
        <div className="bg-cd border border-[var(--bd)] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-sf border-b border-[var(--bd)] text-[10px] tx-mu uppercase font-bold">
                <tr>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Nombre / Descripción</th>
                  <th className="px-4 py-3 text-center">Stock Físico</th>
                  <th className="px-4 py-3 text-center">Reservado</th>
                  <th className="px-4 py-3 text-center">Disponible</th>
                  <th className="px-4 py-3 text-right">Costo Unit.</th>
                  <th className="px-4 py-3 text-right">Valorización</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center tx-mu">
                      No se encontraron SKUs con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  filteredInventory.map(item => {
                    const valorizado = (item.stock_fisico || 0) * (item.costo_unitario || 0);
                    const esBajo = item.stock_disponible <= (item.stock_minimo_alerta || 5);

                    return (
                      <tr key={item.sku} className="hover:bg-sf/50 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-[var(--tx)] whitespace-nowrap">
                          {item.sku}
                        </td>
                        <td className="px-4 py-3 font-medium text-[var(--tx)] max-w-xs truncate">
                          {item.nombre}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold">
                          {item.stock_fisico}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-amber-500 font-bold">
                          {item.stock_reservado > 0 ? `-${item.stock_reservado}` : '0'}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold">
                          <span className={`px-2 py-0.5 rounded-full ${
                            item.stock_disponible <= 0 
                              ? 'bg-rose-500/10 text-rose-600' 
                              : esBajo 
                              ? 'bg-amber-500/10 text-amber-600' 
                              : 'bg-emerald-500/10 text-emerald-600'
                          }`}>
                            {item.stock_disponible}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tx-mu">
                          ${(item.costo_unitario || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-[var(--tx)]">
                          ${valorizado.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setEntradaSku(item.sku);
                                setEntradaCosto(String(item.costo_unitario || ''));
                                setShowEntradaModal(true);
                              }}
                              className="px-2.5 py-1 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 rounded-lg text-[11px] font-bold transition-colors"
                              title="Registrar entrada de mercadería"
                            >
                              + Entrada
                            </button>
                            <button
                              onClick={() => {
                                setAjusteSku(item.sku);
                                setAjusteNuevoStock(String(item.stock_fisico));
                                setShowAjusteModal(true);
                              }}
                              className="px-2.5 py-1 border border-[var(--bd)] hover:bg-sf rounded-lg text-[11px] font-semibold transition-colors"
                              title="Ajustar stock físico"
                            >
                              Ajustar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CONTENIDO PESTAÑA 3: KÁRDEX INMUTABLE DE MOVIMIENTOS */}
      {tab === 'kardex' && (
        <div className="bg-cd border border-[var(--bd)] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-sf border-b border-[var(--bd)] text-[10px] tx-mu uppercase font-bold">
                <tr>
                  <th className="px-4 py-3">Fecha y Hora</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Tipo de Movimiento</th>
                  <th className="px-4 py-3 text-center">Cantidad</th>
                  <th className="px-4 py-3 text-center">Saldo Bodega</th>
                  <th className="px-4 py-3">Motivo / Concepto</th>
                  <th className="px-4 py-3">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {filteredKardex.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center tx-mu">
                      No hay registros en el Kárdex todavía. Las entradas y salidas automáticas aparecerán aquí.
                    </td>
                  </tr>
                ) : (
                  filteredKardex.map(k => (
                    <tr key={k.id} className="hover:bg-sf/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap tx-mu">
                        {new Date(k.created_at).toLocaleString('es-SV', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-[var(--tx)]">
                        {k.sku}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getTipoBadge(k.tipo_movimiento)}
                      </td>
                      <td className={`px-4 py-3 text-center font-mono font-bold ${k.cantidad > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {k.cantidad > 0 ? `+${k.cantidad}` : k.cantidad}
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-[var(--tx)]">
                        {k.saldo_fisico}
                      </td>
                      <td className="px-4 py-3 max-w-sm truncate text-[var(--tx)]">
                        {k.motivo}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-[10px] tx-mu">
                        {k.usuario || 'Sistema'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DRAWER LATERAL: EDICIÓN COMPLETA, FOTOS Y BOT TODD */}
      {selectedProduct && (
        <>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity" onClick={() => setSelectedProduct(null)} />
          <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[500px] bg-cd z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header del Drawer */}
            <div className="p-4 border-b border-[var(--bd)] flex justify-between items-center bg-sf">
              <div>
                <span className="text-[10px] font-mono tx-mu uppercase">Ficha de Producto #{selectedProduct.template_id}</span>
                <h2 className="font-black text-sm truncate max-w-[340px] text-[var(--tx)]">{editNombre || 'Sin nombre'}</h2>
              </div>
              <button onClick={() => setSelectedProduct(null)} className="p-1.5 hover:bg-black/10 rounded-lg">
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
                  drawerTab === 'todd' ? 'bg-purple-600 text-white shadow-sm' : 'text-purple-600 dark:text-purple-400 hover:bg-purple-500/10'
                }`}
              >
                <Bot size={14} /> Bot Todd (WhatsApp)
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
              {/* SUB-PESTAÑA 1: GENERAL & FOTO */}
              {drawerTab === 'info' && (
                <div className="space-y-4">
                  {/* Foto del Producto con Uploader */}
                  <div className="p-4 bg-sf rounded-2xl border border-[var(--bd)] flex flex-col sm:flex-row items-center gap-4">
                    <div className="w-28 h-28 rounded-2xl bg-cd border border-[var(--bd)] overflow-hidden shrink-0 relative shadow-inner flex items-center justify-center">
                      <ProductImg src={editImageUrl} className="w-full h-full object-cover" />
                      {isUploadingPhoto && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-xs font-bold">
                          Optimizando...
                        </div>
                      )}
                    </div>

                    <div className="flex-1 space-y-2 w-full text-center sm:text-left">
                      <span className="text-xs font-bold block text-[var(--tx)]">Foto del Producto</span>
                      <p className="text-[11px] tx-mu">
                        Sube una foto desde tu computadora o teléfono. Se optimiza y comprime automáticamente.
                      </p>

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
                          <LinkIcon size={14} /> Pegar URL
                        </button>

                        {editImageUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditImageUrl('');
                              updateProductDetails({ template_id: selectedProduct.template_id, image_url: null });
                            }}
                            className="px-2.5 py-1.5 text-rose-500 hover:bg-rose-500/10 rounded-xl text-xs font-semibold"
                            title="Quitar foto actual"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      {showUrlInput && (
                        <div className="mt-2 pt-2 border-t border-[var(--bd)] flex gap-2">
                          <input
                            type="url"
                            placeholder="https://ejemplo.com/foto.jpg"
                            value={editImageUrl}
                            onChange={e => setEditImageUrl(e.target.value)}
                            className="flex-1 p-2 bg-cd border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-[var(--ac)]"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Nombre y Estado */}
                  <div>
                    <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Nombre Comercial del Producto *</label>
                    <input
                      type="text"
                      value={editNombre}
                      onChange={e => setEditNombre(e.target.value)}
                      placeholder="Ej. Mini Masajeador Cervical EMS"
                      className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-medium outline-none focus:border-[var(--ac)]"
                    />
                  </div>

                  {/* Precios y Costos */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Precio de Venta ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editPrecio}
                        onChange={e => setEditPrecio(e.target.value)}
                        placeholder="Ej. 25.00"
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-sm font-bold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Costo Unitario ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editCosto}
                        onChange={e => setEditCosto(e.target.value)}
                        placeholder="Ej. 3.50"
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-sm font-bold outline-none"
                      />
                    </div>
                  </div>

                  {/* Switch de Estado de Venta */}
                  <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[var(--tx)] block">Estado del Producto</span>
                      <span className="text-[10px] tx-mu">Activo para pedidos y visible en catálogo</span>
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

              {/* SUB-PESTAÑA 2: INTELIGENCIA PARA BOT TODD (WHATSAPP & UNICHAT) */}
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
                      Todd usará esta ficha cuando los clientes de WhatsApp o UniChat pregunten por este producto. Responderá con tono vendedor, mencionando beneficios, ofertas y disponibilidad real sin inventar información.
                    </p>
                  </div>

                  {/* Toggle para Venta Activa por Bot Todd */}
                  <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[var(--tx)] block">Venta Activa por Bot Todd</span>
                      <span className="text-[10px] tx-mu">Permite que Todd ofrezca y cierre ventas de este ítem por WhatsApp</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditActivoTodd(!editActivoTodd)}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                        editActivoTodd 
                          ? 'bg-purple-600 text-white shadow-sm' 
                          : 'bg-sf border border-[var(--bd)] tx-mu'
                      }`}
                    >
                      {editActivoTodd ? '✓ Habilitado' : '✕ Deshabilitado'}
                    </button>
                  </div>

                  {/* Pitch Comercial */}
                  <div>
                    <label className="block text-[10px] uppercase font-bold tx-mu mb-1 flex items-center gap-1.5">
                      <Sparkles size={12} className="text-purple-500" /> Pitch de Venta & Beneficios Clave
                    </label>
                    <textarea
                      rows={3}
                      value={editToddPitch}
                      onChange={e => setEditToddPitch(e.target.value)}
                      placeholder="Ej. Alivia contracturas y dolores musculares en 15 minutos gracias a su tecnología de microcorrientes EMS. Incluye 8 modos de masaje y batería recargable por USB."
                      className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-purple-500 leading-relaxed resize-none"
                    />
                    <span className="text-[10px] tx-mu block mt-1">Todd recitará estos argumentos cuando el cliente pida detalles o tenga dudas de compra.</span>
                  </div>

                  {/* Reglas e Instrucciones Especiales */}
                  <div>
                    <label className="block text-[10px] uppercase font-bold tx-mu mb-1 flex items-center gap-1.5">
                      <MessageSquare size={12} className="text-purple-500" /> Ofertas & Reglas del Bot (Upsells / Combos)
                    </label>
                    <input
                      type="text"
                      value={editToddInstrucciones}
                      onChange={e => setEditToddInstrucciones(e.target.value)}
                      placeholder="Ej. Ofrecer promoción 2 por $25 o 3 por $30. Garantía de 30 días."
                      className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-purple-500"
                    />
                  </div>

                  {/* Palabras Clave / Keywords */}
                  <div>
                    <label className="block text-[10px] uppercase font-bold tx-mu mb-1 flex items-center gap-1.5">
                      <Tag size={12} className="text-purple-500" /> Sinónimos y Palabras Clave de WhatsApp
                    </label>
                    <input
                      type="text"
                      value={editToddKeywords}
                      onChange={e => setEditToddKeywords(e.target.value)}
                      placeholder="Ej. masajeador, cuello, dolores, parches, ems, electroestimulador"
                      className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-purple-500"
                    />
                    <span className="text-[10px] tx-mu block mt-1">Separadas por comas. Todd las usa para identificar el producto automáticamente en conversaciones.</span>
                  </div>

                  {/* Simulador Interactivo de Respuesta de WhatsApp */}
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
                        <Sparkles size={11} /> Probar Simulación
                      </button>
                    </div>

                    <div className="p-3 bg-emerald-950/10 dark:bg-emerald-900/20 rounded-xl border border-emerald-500/20 text-xs font-mono leading-relaxed whitespace-pre-wrap text-[var(--tx)]">
                      {simRespuesta || (
                        <span className="tx-mu italic font-sans text-[11px]">
                          Presiona "Probar Simulación" para ver cómo responderá Todd a un cliente interesado en WhatsApp.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SUB-PESTAÑA 3: VARIANTES Y STOCK */}
              {drawerTab === 'variantes' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs uppercase tx-mu flex items-center gap-2">
                      <Package size={15} /> Variantes Vinculadas ({productVariants.length})
                    </h4>
                  </div>

                  <div className="flex flex-col gap-2">
                    {productVariants.length === 0 && (
                      <div className="text-xs tx-mu p-4 bg-sf rounded-xl border border-[var(--bd)] text-center">
                        Sin variantes registradas para este producto.
                      </div>
                    )}
                    {productVariants.map(v => {
                      const stockNativo = stockItems.find(s => s.sku === v.sku);
                      const disponible = stockNativo ? stockNativo.stock_disponible : (inv.data?.find(i => i.sku === v.sku)?.qty ?? 0);

                      return (
                        <div key={v.variante_id || v.sku} className="p-3 bg-sf border border-[var(--bd)] rounded-xl flex items-center justify-between">
                          <div>
                            <div className="mono text-xs font-bold text-[var(--tx)]">{v.sku}</div>
                            <div className="text-[10px] tx-mu mt-0.5">
                              {[v.color, v.talla].filter(Boolean).join(' • ') || 'Estándar'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-xs">${Number(v.precio || 0).toFixed(2)}</div>
                            <div className={`text-[10px] font-bold ${disponible <= 0 ? 'text-rose-500' : disponible <= 5 ? 'text-amber-500' : 'text-emerald-500'}`}>
                              {disponible} disponibles
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer de Acciones del Drawer */}
            <div className="p-4 border-t border-[var(--bd)] bg-sf flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className="px-3 py-2 border border-rose-500/20 text-rose-600 hover:bg-rose-500/10 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <Trash2 size={14} /> Eliminar
              </button>

              <div className="flex items-center gap-2">
                {saveSuccessMsg && (
                  <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 animate-pulse">
                    <CheckCircle2 size={14} /> ¡Guardado!
                  </span>
                )}

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
          </div>
        </>
      )}

      {/* MODAL: CONFIRMACIÓN DE ELIMINACIÓN DE PRODUCTO */}
      {showDeleteModal && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowDeleteModal(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2 text-rose-500">
                <Trash2 size={18} />
                <h3 className="font-bold text-sm">¿Eliminar o Desactivar Producto?</h3>
              </div>
              <button onClick={() => setShowDeleteModal(false)} className="p-1 rounded-lg hover:bg-black/10"><X size={16} /></button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs leading-relaxed tx-mu">
                Estás gestionando el producto <strong className="text-[var(--tx)] font-semibold">{selectedProduct.nombre_base}</strong> (#{selectedProduct.template_id}). Elige la acción adecuada:
              </p>

              <div className="space-y-3">
                <div 
                  onClick={() => handleDeleteProduct(false)}
                  className="p-3.5 rounded-xl border border-[var(--bd)] bg-sf hover:border-amber-500/50 hover:bg-amber-500/5 cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-600 flex items-center gap-1.5">
                      ⏸️ Desactivar / Ocultar (Recomendado)
                    </span>
                    <ChevronRight size={14} className="tx-mu" />
                  </div>
                  <p className="text-[11px] tx-mu mt-1">
                    Mantiene los registros contables y de ventas intactos, pero oculta el producto del catálogo y evita que el Bot Todd lo ofrezca.
                  </p>
                </div>

                <div 
                  onClick={() => handleDeleteProduct(true)}
                  className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10 cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-600 flex items-center gap-1.5">
                      🗑️ Eliminar Definitivamente (Pruebas)
                    </span>
                    <ChevronRight size={14} className="text-rose-500" />
                  </div>
                  <p className="text-[11px] text-rose-600/80 dark:text-rose-400/80 mt-1">
                    Borra completamente el registro de Supabase, sus variantes y su stock. Úsalo para limpiar productos de prueba.
                  </p>
                </div>
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

      {/* MODAL 1: NUEVA ENTRADA DE MERCADERÍA / COMPRA */}
      {showEntradaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowEntradaModal(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <ArrowDownLeft size={18} className="text-emerald-500" />
                <h3 className="font-bold text-sm">Entrada de Mercadería (Lote de Compra)</h3>
              </div>
              <button onClick={() => setShowEntradaModal(false)} className="p-1 rounded-lg hover:bg-black/10"><X size={16} /></button>
            </div>

            <form onSubmit={handleSaveEntrada} className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">SKU del Producto *</label>
                <input
                  type="text"
                  value={entradaSku}
                  onChange={e => setEntradaSku(e.target.value.toUpperCase())}
                  placeholder="Ej. MINI-EMS-01"
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs uppercase font-mono font-bold outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Cantidad Entrante *</label>
                  <input
                    type="number"
                    min="1"
                    value={entradaCantidad}
                    onChange={e => setEntradaCantidad(e.target.value)}
                    placeholder="Ej. 100"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-base font-bold outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Costo Unitario ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={entradaCosto}
                    onChange={e => setEntradaCosto(e.target.value)}
                    placeholder="Ej. 3.50"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-base font-bold outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Proveedor / Origen</label>
                  <input
                    type="text"
                    value={entradaProveedor}
                    onChange={e => setEntradaProveedor(e.target.value)}
                    placeholder="Ej. Importadora Central"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Notas / Factura</label>
                  <input
                    type="text"
                    value={entradaNotas}
                    onChange={e => setEntradaNotas(e.target.value)}
                    placeholder="Factura #1234"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                  />
                </div>
              </div>

              <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="asentarFinanzas"
                  checked={entradaAsentarFinanzas}
                  onChange={e => setEntradaAsentarFinanzas(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-0"
                />
                <label htmlFor="asentarFinanzas" className="text-xs cursor-pointer">
                  <span className="font-bold text-[var(--tx)] block">Asentar egreso automático en Finanzas</span>
                  <span className="text-[10px] tx-mu block">
                    Registrará el pago de ${((parseInt(entradaCantidad || '0')) * (parseFloat(entradaCosto || '0'))).toFixed(2)} en la cuenta de Banco Principal y emitirá el evento al Event Store.
                  </span>
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowEntradaModal(false)} className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingEntrada}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm"
                >
                  {isSavingEntrada ? 'Procesando...' : 'Asentar Entrada a Bodega'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: AJUSTE MANUAL DE STOCK */}
      {showAjusteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowAjusteModal(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <h3 className="font-bold text-sm">Ajustar Stock Físico</h3>
              <button onClick={() => setShowAjusteModal(false)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <form onSubmit={handleSaveAjuste} className="p-5 space-y-4">
              <div>
                <span className="text-xs font-bold font-mono text-[var(--tx)] block">{ajusteSku}</span>
                <span className="text-[10px] tx-mu">Define el conteo físico real en estante.</span>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Nuevo Stock Físico *</label>
                <input
                  type="number"
                  min="0"
                  value={ajusteNuevoStock}
                  onChange={e => setAjusteNuevoStock(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xl font-bold outline-none"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Motivo del Ajuste *</label>
                <select
                  value={ajusteMotivo}
                  onChange={e => setAjusteMotivo(e.target.value)}
                  className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                >
                  <option value="Conteo físico periódico">Conteo físico periódico</option>
                  <option value="Merma o producto quebrado">Merma o producto quebrado</option>
                  <option value="Muestra para creador de contenido">Muestra para creador de contenido</option>
                  <option value="Corrección de inventario Odoo">Corrección de inventario Odoo</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowAjusteModal(false)} className="px-3 py-1.5 border border-[var(--bd)] rounded-xl text-xs font-semibold">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingAjuste}
                  className="px-4 py-1.5 bg-[var(--ac)] text-white font-bold rounded-xl text-xs"
                >
                  {isSavingAjuste ? 'Guardando...' : 'Aplicar Ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: CREAR PRODUCTO NUEVO */}
      {showProductoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowProductoModal(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <h3 className="font-bold text-sm">Crear Producto en Catálogo Nativo</h3>
              <button onClick={() => setShowProductoModal(false)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <form onSubmit={handleSaveProducto} className="p-5 space-y-3">
              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Nombre del Producto *</label>
                <input
                  type="text"
                  value={prodNombre}
                  onChange={e => setProdNombre(e.target.value)}
                  placeholder="Ej. Mini Masajeador EMS Pro"
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">SKU Principal *</label>
                  <input
                    type="text"
                    value={prodSku}
                    onChange={e => setProdSku(e.target.value.toUpperCase())}
                    placeholder="MINI-EMS-01"
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs uppercase font-mono font-bold outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Stock Inicial</label>
                  <input
                    type="number"
                    min="0"
                    value={prodStockInicial}
                    onChange={e => setProdStockInicial(e.target.value)}
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Precio de Venta ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={prodPrecio}
                    onChange={e => setProdPrecio(e.target.value)}
                    placeholder="35.00"
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Costo Unitario Compra ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={prodCosto}
                    onChange={e => setProdCosto(e.target.value)}
                    placeholder="3.50"
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">URL de Imagen (Opcional)</label>
                <input
                  type="url"
                  value={prodImagen}
                  onChange={e => setProdImagen(e.target.value)}
                  placeholder="https://..."
                  className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                />
              </div>

              {/* Campos opcionales para Bot Todd */}
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
                  placeholder="Palabras clave: masajeador, dolor, cuello"
                  className="w-full p-2 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowProductoModal(false)} className="px-3.5 py-1.5 border border-[var(--bd)] rounded-xl text-xs font-semibold">
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

      {/* MODAL 4: SCRIPT SQL SPRINT 3 & BOT TODD */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowSqlModal(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl flex flex-col">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <Code size={18} className="text-emerald-500" />
                <h3 className="font-bold text-sm">Script SQL Sprint 3 — Inventario Nativo, Kárdex & Bot Todd</h3>
              </div>
              <button onClick={() => setShowSqlModal(false)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="p-4 bg-sf rounded-xl border border-[var(--bd)] text-xs tx-mu space-y-1">
                <p className="font-semibold text-[var(--tx)]">Instrucciones para Supabase:</p>
                <p>1. Copia el script abajo.</p>
                <p>2. Pégalo en tu SQL Editor de Supabase y presiona <strong>Run</strong>.</p>
                <p>3. Migrará automáticamente tu stock existente a <code className="font-mono bg-cd px-1 rounded">inventory.stock</code>, instalará el motor de Kárdex y habilitará los campos de inteligencia para el Bot Todd.</p>
              </div>

              <div className="relative">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-mono tx-mu">docs/20261108_sprint3_todd_bot_catalog.sql</span>
                  <button
                    onClick={copySql}
                    className="px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-sm"
                  >
                    {copiedSql ? <Check size={14} /> : <Copy size={14} />}
                    {copiedSql ? '¡Copiado!' : 'Copiar Script SQL'}
                  </button>
                </div>
                <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-200 font-mono text-xs overflow-x-auto max-h-96 border border-zinc-800 leading-relaxed">
                  {SPRINT3_SQL_CODE}
                </pre>
              </div>
            </div>

            <div className="p-4 border-t border-[var(--bd)] bg-sf flex justify-end">
              <button onClick={() => setShowSqlModal(false)} className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
