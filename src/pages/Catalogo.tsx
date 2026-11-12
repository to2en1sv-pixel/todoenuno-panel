import { useState, useMemo, useEffect, useRef } from 'react';
import { useProductos, useVariantes, useInventory } from '@/hooks/useCatalog';
import { 
  Search, 
  Package, 
  AlertTriangle, 
  X, 
  Plus, 
  ArrowDownLeft, 
  Code, 
  Copy, 
  Check, 
  Sparkles, 
  Boxes, 
  Layers, 
  History,
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
  CreditCard,
  PackagePlus
} from 'lucide-react';
import { 
  fetchStockItems, 
  fetchKardexMovements, 
  recordStockEntry, 
  adjustStock, 
  quickAddStockDelta,
  saveProductItem,
  compressImageFile,
  updateProductDetails,
  deleteProductItem,
  getToddProductConfig
} from '@/lib/inventory';
import type { 
  StockItem, 
  KardexMovement
} from '@/types/inventory';

const SPRINT10_SQL_CODE = `-- ============================================================================
-- TODOENUNO OS — SPRINT 10: REPARACIÓN Y CONEXIÓN TOTAL DE CATÁLOGO E INVENTARIO
-- Ejecutar en: Supabase SQL Editor
-- ============================================================================

create schema if not exists inventory;

-- 1. Tabla maestra inventory.stock
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
  todd_pitch          text default '',
  todd_instrucciones  text default '',
  todd_keywords       text default '',
  activo_todd         boolean not null default true,
  categoria           text default 'General',
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

alter table inventory.stock
  add column if not exists todd_pitch text default '',
  add column if not exists todd_instrucciones text default '',
  add column if not exists todd_keywords text default '',
  add column if not exists activo_todd boolean not null default true,
  add column if not exists categoria text default 'General';

-- 2. Tabla inventory.kardex con ON DELETE CASCADE y tipo 'inventario_inicial'
create table if not exists inventory.kardex (
  id               bigint generated always as identity primary key,
  sku              text not null references inventory.stock(sku) on update cascade on delete cascade,
  tipo_movimiento  text not null,
  cantidad         integer not null,
  costo_unitario   numeric(10,2) not null default 0.00,
  saldo_fisico     integer not null,
  motivo           text not null,
  source_table     text,
  source_id        text,
  usuario          text default 'Sistema',
  created_at       timestamptz not null default now()
);

do $$
declare v_con_name text;
begin
  for v_con_name in
    select conname from pg_constraint
    where conrelid = 'inventory.kardex'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%tipo_movimiento%'
  loop
    execute format('alter table inventory.kardex drop constraint if exists %I', v_con_name);
  end loop;

  alter table inventory.kardex add constraint kardex_tipo_movimiento_check
    check (tipo_movimiento in (
      'inventario_inicial', 'compra_entrada', 'venta_salida', 'reserva_pedido',
      'devolucion_entrada', 'ajuste_positivo', 'ajuste_negativo', 'merma_dano'
    ));

  for v_con_name in
    select conname from pg_constraint
    where conrelid = 'inventory.kardex'::regclass and contype = 'f'
  loop
    execute format('alter table inventory.kardex drop constraint if exists %I', v_con_name);
  end loop;

  alter table inventory.kardex add constraint kardex_sku_fkey
    foreign key (sku) references inventory.stock(sku) on update cascade on delete cascade;
end;
$$;

-- 3. Función atómica inventory.record_movement + wrapper public.record_movement
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
  v_sku_clean text;
  v_stock_actual integer;
  v_reservado_actual integer;
  v_nuevo_fisico integer;
  v_nuevo_reservado integer;
  v_delta integer;
  v_kardex_id bigint;
begin
  v_sku_clean := upper(trim(p_sku));

  insert into inventory.stock (sku, nombre, stock_fisico, created_at)
  values (v_sku_clean, v_sku_clean, 0, now()) on conflict (sku) do nothing;

  select stock_fisico, stock_reservado
    into v_stock_actual, v_reservado_actual
    from inventory.stock where sku = v_sku_clean for update;

  v_nuevo_fisico    := v_stock_actual;
  v_nuevo_reservado := v_reservado_actual;
  v_delta           := abs(coalesce(p_cantidad, 0));

  if p_tipo_movimiento in ('inventario_inicial', 'compra_entrada', 'ajuste_positivo') then
    v_nuevo_fisico := v_stock_actual + v_delta;
    if p_tipo_movimiento in ('compra_entrada', 'inventario_inicial') and coalesce(p_costo_unitario, 0) > 0 then
      update inventory.stock set costo_unitario = p_costo_unitario where sku = v_sku_clean;
    end if;
  elsif p_tipo_movimiento = 'reserva_pedido' then
    v_nuevo_reservado := v_reservado_actual + v_delta;
  elsif p_tipo_movimiento = 'venta_salida' then
    v_nuevo_fisico    := greatest(v_stock_actual - v_delta, 0);
    v_nuevo_reservado := greatest(v_reservado_actual - v_delta, 0);
    v_delta           := -v_delta;
  elsif p_tipo_movimiento in ('ajuste_negativo', 'merma_dano') then
    v_nuevo_fisico := greatest(v_stock_actual - v_delta, 0);
    v_delta        := -v_delta;
  elsif p_tipo_movimiento = 'devolucion_entrada' then
    v_nuevo_reservado := greatest(v_reservado_actual - v_delta, 0);
    v_nuevo_fisico    := v_stock_actual + v_delta;
  end if;

  update inventory.stock
     set stock_fisico = v_nuevo_fisico, stock_reservado = v_nuevo_reservado, updated_at = now()
   where sku = v_sku_clean;

  insert into inventory.kardex (
    sku, tipo_movimiento, cantidad, costo_unitario, saldo_fisico, motivo, source_table, source_id, usuario
  ) values (
    v_sku_clean, p_tipo_movimiento, v_delta, coalesce(p_costo_unitario, 0.00),
    v_nuevo_fisico, coalesce(nullif(trim(p_motivo), ''), p_tipo_movimiento),
    p_source_table, p_source_id, p_usuario
  ) returning id into v_kardex_id;

  return jsonb_build_object(
    'success', true, 'kardex_id', v_kardex_id, 'sku', v_sku_clean,
    'saldo_fisico', v_nuevo_fisico, 'saldo_reservado', v_nuevo_reservado,
    'saldo_disponible', greatest(v_nuevo_fisico - v_nuevo_reservado, 0)
  );
end;
$$;

create or replace function public.record_movement(
  p_sku             text,
  p_tipo_movimiento text,
  p_cantidad        integer,
  p_costo_unitario  numeric default 0.00,
  p_motivo          text default '',
  p_source_table    text default 'manual',
  p_source_id       text default null,
  p_usuario         text default 'Panel Admin'
) returns jsonb language plpgsql security definer as $$
begin
  return inventory.record_movement(
    p_sku, p_tipo_movimiento, p_cantidad, p_costo_unitario,
    p_motivo, p_source_table, p_source_id, p_usuario
  );
end;
$$;

-- 4. RPC para eliminar productos en cascada sin bloqueos FK/RLS
create or replace function public.delete_inventory_product(
  p_sku         text default null,
  p_template_id text default null
) returns jsonb language plpgsql security definer as $$
declare v_sku_clean text;
begin
  v_sku_clean := nullif(upper(trim(coalesce(p_sku, ''))), '');

  if v_sku_clean is not null then
    delete from inventory.kardex where upper(sku) = v_sku_clean;
    delete from inventory.stock where upper(sku) = v_sku_clean;
    if exists (select from pg_tables where schemaname = 'public' and tablename = 'inventory_cache') then
      execute 'delete from public.inventory_cache where upper(sku) = $1' using v_sku_clean;
    end if;
    if exists (select from pg_tables where schemaname = 'public' and tablename = 'productos_variantes') then
      execute 'delete from public.productos_variantes where upper(sku) = $1' using v_sku_clean;
    end if;
  end if;

  if p_template_id is not null and trim(p_template_id) <> '' then
    delete from inventory.stock where template_id = p_template_id;
    if exists (select from pg_tables where schemaname = 'public' and tablename = 'productos_variantes') then
      execute 'delete from public.productos_variantes where template_id::text = $1' using p_template_id;
    end if;
    if exists (select from pg_tables where schemaname = 'public' and tablename = 'productos') then
      execute 'delete from public.productos where template_id::text = $1' using p_template_id;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- 5. Recrear vistas y otorgar permisos completos (incluyendo DELETE)
drop view if exists public.inventory_stock;
drop view if exists public.inventory_kardex;
create or replace view public.inventory_stock as select * from inventory.stock;
create or replace view public.inventory_kardex as select * from inventory.kardex;

alter table inventory.stock  enable row level security;
alter table inventory.kardex enable row level security;

grant usage on schema inventory to anon, authenticated, service_role;
grant select, insert, update, delete on inventory.stock to anon, authenticated, service_role;
grant select, insert, update, delete on inventory.kardex to anon, authenticated, service_role;
grant select, insert, update, delete on public.inventory_stock to anon, authenticated, service_role;
grant select, insert, update, delete on public.inventory_kardex to anon, authenticated, service_role;

drop policy if exists "inventory_stock_all"  on inventory.stock;
drop policy if exists "inventory_kardex_all" on inventory.kardex;
create policy "inventory_stock_all"  on inventory.stock  for all using (true) with check (true);
create policy "inventory_kardex_all" on inventory.kardex for all using (true) with check (true);

grant execute on function inventory.record_movement to anon, authenticated, service_role;
grant execute on function public.record_movement to anon, authenticated, service_role;
grant execute on function public.delete_inventory_product to anon, authenticated, service_role;
`;

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

function ProductImg({ 
  src, 
  className = '', 
  fallbackClassName = '' 
}: { 
  src?: string | null; 
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
  const [selectedItem, setSelectedItem] = useState<UnifiedCatalogItem | null>(null);

  // Pestaña interna del Drawer de Producto
  const [drawerTab, setDrawerTab] = useState<'info' | 'todd' | 'variantes'>('info');

  // Datos nativos de inventario y kárdex
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [kardexList, setKardexList] = useState<KardexMovement[]>([]);
  const [loadingNative, setLoadingNative] = useState(true);
  const [isRealDb, setIsRealDb] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

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
  const [editStockMinimo, setEditStockMinimo] = useState('5');
  const [editUbicacion, setEditUbicacion] = useState('Bodega Central');
  const [editActivo, setEditActivo] = useState(true);
  const [editToddPitch, setEditToddPitch] = useState('');
  const [editToddInstrucciones, setEditToddInstrucciones] = useState('');
  const [editToddKeywords, setEditToddKeywords] = useState('');
  const [editActivoTodd, setEditActivoTodd] = useState(true);
  const [quickStockExacto, setQuickStockExacto] = useState('');
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isAdjustingQuick, setIsAdjustingQuick] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);

  // Simulador de Todd Bot en el Drawer
  const [simRespuesta, setSimRespuesta] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);

  // Formulario Entrada de Stock (Sin Compra o Con Compra)
  const [entradaTipo, setEntradaTipo] = useState<'inventario_inicial' | 'compra_entrada'>('inventario_inicial');
  const [entradaSku, setEntradaSku] = useState('');
  const [entradaCantidad, setEntradaCantidad] = useState('');
  const [entradaCosto, setEntradaCosto] = useState('');
  const [entradaProveedor, setEntradaProveedor] = useState('');
  const [entradaNotas, setEntradaNotas] = useState('');
  const [entradaAsentarFinanzas, setEntradaAsentarFinanzas] = useState(false);
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
  const [prodStockMinimo, setProdStockMinimo] = useState('5');
  const [prodImagen, setProdImagen] = useState('');
  const [prodToddPitch, setProdToddPitch] = useState('');
  const [prodToddKeywords, setProdToddKeywords] = useState('');
  const [isSavingProd, setIsSavingProd] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const newProdFileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => {
      setToastMsg(prev => (prev?.text === text ? null : prev));
    }, 5000);
  };

  const loadNativeInventory = async () => {
    setLoadingNative(true);
    const [stockRes, kardexRes] = await Promise.all([
      fetchStockItems(),
      fetchKardexMovements()
    ]);
    setStockItems(stockRes.items);
    setIsRealDb(stockRes.isRealDb);
    setDbError(stockRes.error || null);
    setKardexList(kardexRes.movements);
    setLoadingNative(false);
  };

  useEffect(() => {
    loadNativeInventory();
  }, []);

  // UNIFICAR CATÁLOGO: combina inventory_stock (nativo) + public.productos (legacy Odoo) sin duplicados
  const unifiedCatalog = useMemo<UnifiedCatalogItem[]>(() => {
    const result: UnifiedCatalogItem[] = [];
    const seenTemplateIds = new Set<string>();
    const seenSkus = new Set<string>();

    // 1. Primero todos los items nativos de inventory_stock (fuente maestra)
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

    // 2. Complementar con productos de public.productos (legacy) que aún no estén en inventory_stock
    (productos.data ?? []).forEach((p: any) => {
      const tIdStr = String(p.template_id);
      const nombre = (p.nombre_base || '').trim();
      const lower = nombre.toLowerCase();
      if (lower.includes('fee') || lower.includes('servicio') || lower.includes('envio')) return;

      if (seenTemplateIds.has(tIdStr)) {
        // Si ya está en stockItems por template_id, enriquecer imagen si stockItems no tenía
        const existing = result.find(r => String(r.template_id) === tIdStr);
        if (existing && !existing.image_url && p.image_url) {
          existing.image_url = p.image_url;
        }
        return;
      }

      // Buscar variantes y stock de este legacy product
      const vars = (variantes.data ?? []).filter((v: any) => String(v.template_id) === tIdStr);
      const firstSku = vars[0]?.sku ? String(vars[0].sku).trim().toUpperCase() : `PROD-${tIdStr}`;

      if (seenSkus.has(firstSku)) return;
      seenSkus.add(firstSku);
      seenTemplateIds.add(tIdStr);

      let disp = 0;
      const varSkus = new Set(vars.map((v: any) => String(v.sku || '').trim().toUpperCase()).filter(Boolean));
      stockItems.forEach(s => {
        if (varSkus.has(s.sku.toUpperCase())) {
          disp += Number(s.stock_disponible) || 0;
        }
      });
      if (disp === 0 && inv.data) {
        inv.data.forEach((i: any) => {
          if (varSkus.has(String(i.sku || '').trim().toUpperCase())) {
            disp += Number(i.qty) || 0;
          }
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

  // Mantener selectedItem actualizado tras recargas
  useEffect(() => {
    if (selectedItem) {
      const updated = unifiedCatalog.find(
        u => u.sku === selectedItem.sku || (u.template_id && u.template_id === selectedItem.template_id)
      );
      if (updated) {
        setEditNombre(updated.nombre);
        setEditImageUrl(updated.image_url || '');
        setEditActivo(updated.activo);
        setEditPrecio(updated.precio_venta ? String(updated.precio_venta) : '');
        setEditCosto(updated.costo_unitario ? String(updated.costo_unitario) : '');
        setEditStockMinimo(String(updated.stock_minimo_alerta ?? 5));
        setEditUbicacion(updated.ubicacion || 'Bodega Central');
        setEditToddPitch(updated.todd_pitch || '');
        setEditToddInstrucciones(updated.todd_instrucciones || '');
        setEditToddKeywords(updated.todd_keywords || '');
        setEditActivoTodd(updated.activo_todd);
        setQuickStockExacto(String(updated.stock_fisico));
      }
    }
  }, [selectedItem?.key, stockItems]);

  const handleOpenItem = (item: UnifiedCatalogItem) => {
    setSelectedItem(item);
    setEditNombre(item.nombre);
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
    setQuickStockExacto(String(item.stock_fisico));
    setDrawerTab('info');
    setSimRespuesta('');
    setShowUrlInput(false);
  };

  // 1. FILTRO DE CATÁLOGO VISUAL
  const filteredCatalog = useMemo(() => {
    let list = unifiedCatalog;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(item =>
        item.nombre.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        String(item.template_id || '').toLowerCase().includes(q)
      );
    }

    if (filterStock) {
      list = list.filter(item => item.stock_disponible <= (item.stock_minimo_alerta || 5));
    }

    return list;
  }, [unifiedCatalog, search, filterStock]);

  // 2. FILTRO DE INVENTARIO NATIVO
  const filteredInventory = useMemo(() => {
    let list = stockItems.filter(i => !i.sku.toLowerCase().includes('fee'));

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
    if (!selectedItem || !selectedItem.template_id) return [];
    return (variantes.data ?? []).filter((v: any) => String(v.template_id) === String(selectedItem.template_id));
  }, [variantes.data, selectedItem]);

  // Subir foto en Drawer
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
        await Promise.all([productos.refetch(), loadNativeInventory()]);
      }
    } catch (err: any) {
      showToast('err', err?.message || 'Error al procesar imagen.');
    } finally {
      setIsUploadingPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

  // Subir foto en modal de Nuevo Producto
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

  // Guardar Cambios del Producto Seleccionado
  const handleSaveProductDetails = async () => {
    if (!selectedItem) return;
    setIsSavingDetails(true);

    const res = await updateProductDetails({
      sku: selectedItem.sku,
      template_id: selectedItem.template_id,
      nombre_base: editNombre.trim() || selectedItem.nombre,
      image_url: editImageUrl.trim() || null,
      active: editActivo,
      precio_venta: parseFloat(editPrecio || '0'),
      costo_unitario: parseFloat(editCosto || '0'),
      stock_minimo_alerta: parseInt(editStockMinimo || '5'),
      ubicacion: editUbicacion.trim() || 'Bodega Central',
      todd_pitch: editToddPitch.trim(),
      todd_instrucciones: editToddInstrucciones.trim(),
      todd_keywords: editToddKeywords.trim(),
      activo_todd: editActivoTodd
    });

    setIsSavingDetails(false);

    if (res.success) {
      showToast('ok', `Producto "${editNombre.trim()}" actualizado correctamente en Supabase.`);
      await Promise.all([productos.refetch(), loadNativeInventory()]);
    } else {
      showToast('err', `Error guardando en Supabase: ${res.error}`);
    }
  };

  // Ajuste rápido de unidades (+1, +5, +10, -1) directo desde el Drawer o Tabla
  const handleQuickDelta = async (sku: string, delta: number, nombreProd?: string) => {
    setIsAdjustingQuick(true);
    // Si es un producto legacy que aún no estaba en inventory_stock, aseguramos su nombre
    if (selectedItem && selectedItem.source === 'legacy' && selectedItem.sku === sku) {
      await updateProductDetails({
        sku,
        template_id: selectedItem.template_id,
        nombre_base: nombreProd || selectedItem.nombre,
        precio_venta: parseFloat(editPrecio || '0'),
        costo_unitario: parseFloat(editCosto || '0')
      });
    }

    const res = await quickAddStockDelta(sku, delta, 'Ingreso/ajuste rápido desde inventario');
    setIsAdjustingQuick(false);

    if (res.success) {
      showToast('ok', `Stock de ${sku} actualizado (${delta > 0 ? `+${delta}` : delta} uds).`);
      await loadNativeInventory();
    } else {
      showToast('err', res.error || 'No se pudo ajustar el stock en Supabase.');
    }
  };

  // Definir stock exacto desde el Drawer
  const handleSetExactStockFromDrawer = async () => {
    if (!selectedItem || quickStockExacto === '') return;
    setIsAdjustingQuick(true);
    if (selectedItem.source === 'legacy') {
      await updateProductDetails({
        sku: selectedItem.sku,
        template_id: selectedItem.template_id,
        nombre_base: editNombre.trim() || selectedItem.nombre,
        precio_venta: parseFloat(editPrecio || '0'),
        costo_unitario: parseFloat(editCosto || '0')
      });
    }

    const res = await adjustStock({
      sku: selectedItem.sku,
      nuevo_stock: parseInt(quickStockExacto || '0'),
      motivo: 'Conteo físico directo en ficha de producto'
    });
    setIsAdjustingQuick(false);

    if (res.success) {
      showToast('ok', `Stock físico de ${selectedItem.sku} fijado en ${quickStockExacto} uds.`);
      await loadNativeInventory();
    } else {
      showToast('err', res.error || 'Error actualizando el stock exacto.');
    }
  };

  // Eliminar o Desactivar Producto
  const handleDeleteProduct = async (hardDelete: boolean) => {
    if (!selectedItem) return;
    setIsSavingDetails(true);

    const res = await deleteProductItem({
      sku: selectedItem.sku,
      template_id: selectedItem.template_id,
      hardDelete
    });

    setIsSavingDetails(false);

    if (res.success) {
      showToast(
        'ok',
        hardDelete
          ? `Producto ${selectedItem.sku} eliminado definitivamente de Supabase.`
          : `Producto ${selectedItem.sku} desactivado.`
      );
      setShowDeleteModal(false);
      setSelectedItem(null);
      await Promise.all([productos.refetch(), variantes.refetch(), inv.refetch(), loadNativeInventory()]);
    } else {
      showToast('err', `Error al eliminar: ${res.error}`);
    }
  };

  // Simular respuesta del Bot Todd
  const handleSimulateTodd = () => {
    if (!selectedItem) return;
    setIsSimulating(true);

    const pitch = editToddPitch || 'Es un producto de alta calidad disponible para entrega inmediata.';
    const reglas = editToddInstrucciones ? `\n(Regla del bot: ${editToddInstrucciones})` : '';
    const precio = editPrecio ? `$${parseFloat(editPrecio).toFixed(2)}` : '$25.00';

    setTimeout(() => {
      setSimRespuesta(
        `¡Hola! 👋 Gracias por consultar por el *${editNombre || selectedItem.nombre}*.\n\n` +
        `${pitch}\n\n` +
        `💰 *Precio especial:* ${precio} USD con pago contra entrega en todo El Salvador 🇸🇻.\n` +
        `📦 *Disponibilidad:* Tenemos ${selectedItem.stock_disponible} uds en bodega listas para envío en 24-48 horas.${reglas}\n\n` +
        `¿Te gustaría que te tomemos los datos de envío ahora mismo? 📲`
      );
      setIsSimulating(false);
    }, 300);
  };

  // Manejo de Entrada de Mercadería (Sin Compra o Con Compra)
  const handleSaveEntrada = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entradaSku || !entradaCantidad) return;
    setIsSavingEntrada(true);

    const res = await recordStockEntry({
      sku: entradaSku.toUpperCase().trim(),
      cantidad: parseInt(entradaCantidad),
      costo_unitario: parseFloat(entradaCosto || '0'),
      tipo_entrada: entradaTipo,
      proveedor: entradaTipo === 'compra_entrada' ? entradaProveedor : undefined,
      notas: entradaNotas,
      asentar_en_finanzas: entradaTipo === 'compra_entrada' ? entradaAsentarFinanzas : false,
      cuenta_finanzas_id: 'banco_principal'
    });

    setIsSavingEntrada(false);

    if (res.success) {
      showToast(
        'ok',
        entradaTipo === 'compra_entrada'
          ? `Compra de ${entradaCantidad}x ${entradaSku.toUpperCase()} asentada en inventario.`
          : `Se sumaron +${entradaCantidad} unidades a ${entradaSku.toUpperCase()} (sin afectar Finanzas).`
      );
      setShowEntradaModal(false);
      setEntradaSku('');
      setEntradaCantidad('');
      setEntradaCosto('');
      setEntradaProveedor('');
      setEntradaNotas('');
      await loadNativeInventory();
    } else {
      showToast('err', res.error || 'Error registrando entrada en Supabase.');
    }
  };

  // Manejo de Ajuste de Stock
  const handleSaveAjuste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ajusteSku || ajusteNuevoStock === '') return;
    setIsSavingAjuste(true);

    const res = await adjustStock({
      sku: ajusteSku,
      nuevo_stock: parseInt(ajusteNuevoStock),
      motivo: ajusteMotivo
    });

    setIsSavingAjuste(false);

    if (res.success) {
      showToast('ok', `Stock físico de ${ajusteSku} actualizado a ${ajusteNuevoStock} unidades.`);
      setShowAjusteModal(false);
      setAjusteSku('');
      setAjusteNuevoStock('');
      await loadNativeInventory();
    } else {
      showToast('err', res.error || 'Error aplicando el ajuste en Supabase.');
    }
  };

  // Manejo de Crear Producto
  const handleSaveProducto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodNombre.trim() || !prodSku.trim()) return;
    setIsSavingProd(true);

    const res = await saveProductItem({
      nombre: prodNombre.trim(),
      sku: prodSku.toUpperCase().trim(),
      precio_venta: parseFloat(prodPrecio || '0'),
      costo_unitario: parseFloat(prodCosto || '0'),
      stock_inicial: parseInt(prodStockInicial || '0'),
      stock_minimo: parseInt(prodStockMinimo || '5'),
      image_url: prodImagen.trim() || undefined,
      todd_pitch: prodToddPitch.trim() || undefined,
      todd_keywords: prodToddKeywords.trim() || undefined
    });

    setIsSavingProd(false);

    if (res.success) {
      showToast('ok', `Producto "${prodNombre.trim()}" (${prodSku.toUpperCase()}) creado en Supabase.`);
      setShowProductoModal(false);
      setProdNombre('');
      setProdSku('');
      setProdPrecio('');
      setProdCosto('');
      setProdStockInicial('0');
      setProdStockMinimo('5');
      setProdImagen('');
      setProdToddPitch('');
      setProdToddKeywords('');
      await Promise.all([productos.refetch(), loadNativeInventory()]);
    } else {
      showToast('err', res.error || 'No se pudo crear el producto en Supabase.');
    }
  };

  const copySql = () => {
    navigator.clipboard.writeText(SPRINT10_SQL_CODE);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const getTipoBadge = (tipo: string) => {
    switch (tipo) {
      case 'inventario_inicial':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">📥 Inventario Inicial</span>;
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
      {/* Inputs de archivo ocultos */}
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
      <input type="file" ref={newProdFileInputRef} onChange={handleNewProdFileUpload} accept="image/*" className="hidden" />

      {/* Toast flotante de feedback real */}
      {toastMsg && (
        <div
          className={`fixed bottom-5 right-5 z-[60] max-w-md px-4 py-3 rounded-2xl shadow-2xl border flex items-center gap-2.5 text-xs font-bold animate-in fade-in slide-in-from-bottom-4 ${
            toastMsg.type === 'ok'
              ? 'bg-emerald-950/95 border-emerald-500/50 text-emerald-200'
              : 'bg-rose-950/95 border-rose-500/50 text-rose-200'
          }`}
        >
          {toastMsg.type === 'ok' ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" /> : <AlertTriangle size={16} className="text-rose-400 shrink-0" />}
          <span className="flex-1">{toastMsg.text}</span>
          <button onClick={() => setToastMsg(null)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* Alerta si falta correr el SQL de Supabase */}
      {(!isRealDb || dbError) && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs">
            <Database size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-amber-600 dark:text-amber-400 block">
                Conexión con Supabase pendiente de actualizar (Sprint 10)
              </span>
              <span className="tx-mu block mt-0.5">
                {dbError || 'Ejecuta el script SQL actualizado en tu Supabase SQL Editor para habilitar altas, eliminaciones en cascada y carga de stock sin compra.'}
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

      {/* Encabezado Principal */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div className="min-w-0 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <Boxes className="text-[var(--ac)] shrink-0" size={24} />
            <h1 className="text-xl sm:text-2xl font-black tracking-tight whitespace-normal sm:whitespace-nowrap">
              Catálogo & Inventario Nativo
            </h1>
            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border shrink-0 flex items-center gap-1 ${
              isRealDb
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
            }`}>
              <Database size={10} /> {isRealDb ? 'Supabase Conectado' : 'Modo Respaldo'}
            </span>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30 flex items-center gap-1 shrink-0">
              <Bot size={12} /> Todd Ready
            </span>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1 max-w-xl">
            Gestión unificada de productos, carga de inventario real (sin necesidad de compra), Kárdex inmutable y entrenamiento para el Bot Todd.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          <button
            onClick={() => {
              setEntradaTipo('inventario_inicial');
              setEntradaAsentarFinanzas(false);
              setShowEntradaModal(true);
            }}
            className="flex-1 sm:flex-none px-3.5 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:opacity-90 shadow-sm"
          >
            <PackagePlus size={15} /> + Ingresar Stock
          </button>

          <button
            onClick={() => setShowProductoModal(true)}
            className="px-3.5 py-2 bg-[var(--ac)] text-white hover:opacity-90 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-opacity shadow-sm"
          >
            <Plus size={14} /> Nuevo Producto
          </button>

          <button
            onClick={loadNativeInventory}
            className="p-2 border border-[var(--bd)] rounded-xl text-xs font-bold hover:bg-sf transition-colors"
            title="Recargar inventario desde Supabase"
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

      {/* Tarjetas KPI de Inventario */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Stock Físico (Bodega)</span>
          <div className="text-2xl font-black mt-1 text-[var(--tx)]">
            {metrics.totalFisico} <span className="text-xs font-normal tx-mu">unidades</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">En {stockItems.length} SKUs en Supabase</span>
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
            <Boxes size={14} /> Catálogo Visual ({filteredCatalog.length})
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

      {/* CONTENIDO PESTAÑA 1: CATÁLOGO VISUAL UNIFICADO */}
      {tab === 'productos' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {loadingNative && filteredCatalog.length === 0 && (
            <div className="col-span-full text-center p-8 tx-mu">Cargando catálogo...</div>
          )}
          {!loadingNative && filteredCatalog.length === 0 && (
            <div className="col-span-full text-center p-10 tx-mu bg-cd rounded-2xl border border-[var(--bd)] space-y-3">
              <div className="text-3xl">📦</div>
              <div className="font-bold text-sm text-[var(--tx)]">Tu catálogo está listo para tu inventario real</div>
              <p className="text-xs max-w-md mx-auto">
                Crea tu primer producto haciendo clic en <strong>+ Nuevo Producto</strong> o ingresa stock directamente.
              </p>
              <button
                onClick={() => setShowProductoModal(true)}
                className="px-4 py-2 bg-[var(--ac)] text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Plus size={14} /> Crear Primer Producto
              </button>
            </div>
          )}
          {filteredCatalog.map(item => {
            const hasToddPitch = Boolean(item.todd_pitch);

            return (
              <div 
                key={item.key} 
                onClick={() => handleOpenItem(item)}
                className="bg-cd border border-[var(--bd)] rounded-2xl p-3 flex flex-col justify-between cursor-pointer hover:border-[var(--ac)] hover:shadow-md transition-all group relative"
              >
                <div>
                  <div className="aspect-square bg-sf rounded-xl overflow-hidden relative flex items-center justify-center">
                    <ProductImg 
                      src={item.image_url} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />

                    {/* Badge de Disponibilidad */}
                    <div className="absolute top-2 right-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shadow-sm ${
                        item.stock_disponible <= 0 
                          ? 'bg-rose-500/90 text-white border-rose-600' 
                          : item.stock_disponible <= item.stock_minimo_alerta 
                          ? 'bg-amber-500/90 text-white border-amber-600' 
                          : 'bg-emerald-500/90 text-white border-emerald-600'
                      }`}>
                        {item.stock_disponible} disp.
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
                      <span className="truncate font-semibold">{item.sku}</span>
                      {!item.activo && (
                        <span className="text-rose-500 font-bold uppercase text-[9px]">Pausado</span>
                      )}
                    </div>
                    <div className="font-bold text-xs line-clamp-2 leading-snug mt-0.5 text-[var(--tx)]">
                      {item.nombre}
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-[var(--bd)] flex items-center justify-between text-[11px]">
                  <span className="font-mono font-bold text-[var(--tx)]">
                    {item.precio_venta > 0 ? `$${item.precio_venta.toFixed(2)}` : 'Sin precio'}
                  </span>
                  <span className="text-[var(--ac)] font-bold group-hover:underline">
                    Editar / Stock →
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
                  <th className="px-4 py-3 text-right">Precio / Costo</th>
                  <th className="px-4 py-3 text-right">Valorización</th>
                  <th className="px-4 py-3 text-right">Acciones Rápidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center tx-mu">
                      No hay SKUs en inventario con estos filtros.
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
                        <td className="px-4 py-3 text-right font-mono tx-mu whitespace-nowrap">
                          <span className="text-[var(--tx)] font-bold">${(item.precio_venta || 0).toFixed(2)}</span>
                          <span className="mx-1">/</span>
                          <span>${(item.costo_unitario || 0).toFixed(2)}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-[var(--tx)]">
                          ${valorizado.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleQuickDelta(item.sku, 1)}
                              disabled={isAdjustingQuick}
                              className="px-2 py-1 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 rounded-lg text-[11px] font-bold"
                              title="Sumar 1 unidad sin compra"
                            >
                              +1
                            </button>
                            <button
                              onClick={() => handleQuickDelta(item.sku, 5)}
                              disabled={isAdjustingQuick}
                              className="px-2 py-1 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 rounded-lg text-[11px] font-bold"
                              title="Sumar 5 unidades sin compra"
                            >
                              +5
                            </button>
                            <button
                              onClick={() => {
                                setEntradaTipo('inventario_inicial');
                                setEntradaAsentarFinanzas(false);
                                setEntradaSku(item.sku);
                                setEntradaCosto(String(item.costo_unitario || ''));
                                setShowEntradaModal(true);
                              }}
                              className="px-2.5 py-1 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 rounded-lg text-[11px] font-bold"
                              title="Ingresar lote o compra"
                            >
                              + Lote
                            </button>
                            <button
                              onClick={() => {
                                setAjusteSku(item.sku);
                                setAjusteNuevoStock(String(item.stock_fisico));
                                setShowAjusteModal(true);
                              }}
                              className="px-2.5 py-1 border border-[var(--bd)] hover:bg-sf rounded-lg text-[11px] font-semibold"
                              title="Fijar stock físico exacto"
                            >
                              Conteo
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
                      No hay registros en el Kárdex todavía. Las entradas y ajustes aparecerán aquí.
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

      {/* DRAWER LATERAL: EDICIÓN COMPLETA, STOCK RÁPIDO, FOTOS Y BOT TODD */}
      {selectedItem && (
        <>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity" onClick={() => setSelectedItem(null)} />
          <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[520px] bg-cd z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            {/* Header del Drawer */}
            <div className="p-4 border-b border-[var(--bd)] flex justify-between items-center bg-sf">
              <div className="min-w-0">
                <span className="text-[10px] font-mono tx-mu uppercase">SKU: {selectedItem.sku}</span>
                <h2 className="font-black text-sm truncate max-w-[360px] text-[var(--tx)]">{editNombre || 'Sin nombre'}</h2>
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
                <Package size={14} /> General & Stock
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
              {/* SUB-PESTAÑA 1: GENERAL, STOCK Y FOTO */}
              {drawerTab === 'info' && (
                <div className="space-y-4">
                  {/* Bloque de Control Rápido de Stock (SIN COMPRA) */}
                  <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                        <PackagePlus size={15} /> Stock en Bodega (Ajuste Directo)
                      </span>
                      <span className="text-[10px] font-mono tx-mu">
                        Físico: <strong>{selectedItem.stock_fisico}</strong> · Reservado: <strong>{selectedItem.stock_reservado}</strong>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isAdjustingQuick}
                        onClick={() => handleQuickDelta(selectedItem.sku, -1, editNombre)}
                        className="px-2.5 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 text-xs font-bold hover:bg-rose-500/20"
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        disabled={isAdjustingQuick}
                        onClick={() => handleQuickDelta(selectedItem.sku, 1, editNombre)}
                        className="px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 text-xs font-bold hover:bg-emerald-500/20"
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        disabled={isAdjustingQuick}
                        onClick={() => handleQuickDelta(selectedItem.sku, 5, editNombre)}
                        className="px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 text-xs font-bold hover:bg-emerald-500/20"
                      >
                        +5
                      </button>
                      <button
                        type="button"
                        disabled={isAdjustingQuick}
                        onClick={() => handleQuickDelta(selectedItem.sku, 10, editNombre)}
                        className="px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 text-xs font-bold hover:bg-emerald-500/20"
                      >
                        +10
                      </button>

                      <div className="flex-1 flex items-center gap-1.5 ml-auto min-w-[150px]">
                        <input
                          type="number"
                          min="0"
                          value={quickStockExacto}
                          onChange={e => setQuickStockExacto(e.target.value)}
                          className="w-20 p-1.5 rounded-lg border border-[var(--bd)] bg-cd text-xs font-mono font-bold text-center outline-none"
                        />
                        <button
                          type="button"
                          disabled={isAdjustingQuick}
                          onClick={handleSetExactStockFromDrawer}
                          className="px-3 py-1.5 bg-[var(--tx)] text-[var(--cd)] rounded-lg text-[11px] font-bold hover:opacity-90 whitespace-nowrap"
                        >
                          Fijar Stock
                        </button>
                      </div>
                    </div>
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

                  {/* Nombre Comercial */}
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
                        placeholder="25.00"
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
                        placeholder="3.50"
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-sm font-bold outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Alerta Stock Mínimo</label>
                      <input
                        type="number"
                        min="0"
                        value={editStockMinimo}
                        onChange={e => setEditStockMinimo(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Ubicación en Bodega</label>
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
                      Todd usará esta ficha en WhatsApp y UniChat con disponibilidad real en bodega.
                    </p>
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
                      <MessageSquare size={12} className="text-purple-500" /> Ofertas & Reglas del Bot
                    </label>
                    <input
                      type="text"
                      value={editToddInstrucciones}
                      onChange={e => setEditToddInstrucciones(e.target.value)}
                      placeholder="Ej. Ofrecer promoción 2 por $25."
                      className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-purple-500"
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
                      placeholder="masajeador, cuello, dolores, ems"
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
                          Presiona "Probar" para ver cómo responderá Todd por WhatsApp.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SUB-PESTAÑA 3: VARIANTES */}
              {drawerTab === 'variantes' && (
                <div className="space-y-3">
                  <h4 className="font-bold text-xs uppercase tx-mu flex items-center gap-2">
                    <Package size={15} /> Variantes Vinculadas ({productVariants.length})
                  </h4>
                  <div className="flex flex-col gap-2">
                    {productVariants.length === 0 && (
                      <div className="text-xs tx-mu p-4 bg-sf rounded-xl border border-[var(--bd)] text-center">
                        Este producto usa un SKU único: <strong className="font-mono text-[var(--tx)]">{selectedItem.sku}</strong>
                      </div>
                    )}
                    {productVariants.map((v: any) => {
                      const stockNativo = stockItems.find(s => s.sku === v.sku);
                      const disponible = stockNativo ? stockNativo.stock_disponible : 0;
                      return (
                        <div key={v.variante_id || v.sku} className="p-3 bg-sf border border-[var(--bd)] rounded-xl flex items-center justify-between">
                          <div>
                            <div className="mono text-xs font-bold text-[var(--tx)]">{v.sku}</div>
                            <div className="text-[10px] tx-mu mt-0.5">{[v.color, v.talla].filter(Boolean).join(' • ') || 'Estándar'}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-xs">${Number(v.precio || 0).toFixed(2)}</div>
                            <div className="text-[10px] font-bold text-emerald-500">{disponible} disp.</div>
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
                Producto: <strong className="text-[var(--tx)]">{selectedItem.nombre}</strong> (<span className="font-mono">{selectedItem.sku}</span>)
              </p>

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
                    Borra el producto, su stock y sus registros de prueba en Supabase de raíz.
                  </p>
                </button>
              </div>

              <div className="pt-2 flex justify-end">
                <button type="button" onClick={() => setShowDeleteModal(false)} className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold hover:bg-sf">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: INGRESAR STOCK (SIN COMPRA O CON COMPRA) */}
      {showEntradaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowEntradaModal(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <PackagePlus size={18} className="text-emerald-500" />
                <h3 className="font-bold text-sm">Ingresar Unidades a Bodega</h3>
              </div>
              <button onClick={() => setShowEntradaModal(false)} className="p-1 rounded-lg hover:bg-black/10"><X size={16} /></button>
            </div>

            <form onSubmit={handleSaveEntrada} className="p-5 space-y-4">
              {/* Selector de Tipo de Entrada */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-sf rounded-xl border border-[var(--bd)]">
                <button
                  type="button"
                  onClick={() => {
                    setEntradaTipo('inventario_inicial');
                    setEntradaAsentarFinanzas(false);
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    entradaTipo === 'inventario_inicial'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  <Boxes size={14} /> Stock Real / Sin Compra
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEntradaTipo('compra_entrada');
                    setEntradaAsentarFinanzas(true);
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    entradaTipo === 'compra_entrada'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  <CreditCard size={14} /> Compra a Proveedor
                </button>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">SKU del Producto *</label>
                <input
                  type="text"
                  list="skus-existentes"
                  value={entradaSku}
                  onChange={e => setEntradaSku(e.target.value.toUpperCase())}
                  placeholder="Escribe o selecciona un SKU (ej. MINI-EMS-01)"
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs uppercase font-mono font-bold outline-none focus:border-[var(--ac)]"
                  required
                />
                <datalist id="skus-existentes">
                  {stockItems.map(s => (
                    <option key={s.sku} value={s.sku}>{s.nombre} ({s.stock_fisico} uds)</option>
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Unidades a Sumar *</label>
                  <input
                    type="number"
                    min="1"
                    value={entradaCantidad}
                    onChange={e => setEntradaCantidad(e.target.value)}
                    placeholder="Ej. 25"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-base font-bold outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                    {entradaTipo === 'compra_entrada' ? 'Costo Unitario ($)' : 'Costo Ref. ($ Opcional)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={entradaCosto}
                    onChange={e => setEntradaCosto(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-base font-bold outline-none"
                  />
                </div>
              </div>

              {entradaTipo === 'compra_entrada' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Proveedor</label>
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
                        Registrará el pago de ${((parseInt(entradaCantidad || '0')) * (parseFloat(entradaCosto || '0'))).toFixed(2)} en Banco Principal.
                      </span>
                    </label>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Motivo / Nota (Opcional)</label>
                  <input
                    type="text"
                    value={entradaNotas}
                    onChange={e => setEntradaNotas(e.target.value)}
                    placeholder="Ej. Existencia física actual en bodega"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                  />
                  <p className="text-[10px] text-indigo-500 mt-1.5 font-medium">
                    ✓ Esta carga suma las unidades directamente a tu inventario real sin crear egresos ni deudas en Finanzas.
                  </p>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowEntradaModal(false)} className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingEntrada}
                  className={`px-5 py-2 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm ${
                    entradaTipo === 'compra_entrada' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  {isSavingEntrada ? 'Guardando...' : entradaTipo === 'compra_entrada' ? 'Registrar Compra' : 'Sumar a Bodega'}
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
              <h3 className="font-bold text-sm">Conteo Físico Real</h3>
              <button onClick={() => setShowAjusteModal(false)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <form onSubmit={handleSaveAjuste} className="p-5 space-y-4">
              <div>
                <span className="text-xs font-bold font-mono text-[var(--tx)] block">{ajusteSku}</span>
                <span className="text-[10px] tx-mu">Define cuántas unidades físicas existen exactamente hoy.</span>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Stock Físico Real *</label>
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
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Motivo *</label>
                <select
                  value={ajusteMotivo}
                  onChange={e => setAjusteMotivo(e.target.value)}
                  className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                >
                  <option value="Conteo físico periódico">Conteo físico periódico</option>
                  <option value="Carga de inventario real">Carga de inventario real</option>
                  <option value="Merma o producto quebrado">Merma o producto quebrado</option>
                  <option value="Muestra para creador de contenido">Muestra para creador de contenido</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowAjusteModal(false)} className="px-3 py-1.5 border border-[var(--bd)] rounded-xl text-xs font-semibold">
                  Cancelar
                </button>
                <button type="submit" disabled={isSavingAjuste} className="px-4 py-1.5 bg-[var(--ac)] text-white font-bold rounded-xl text-xs">
                  {isSavingAjuste ? 'Guardando...' : 'Aplicar Conteo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: CREAR PRODUCTO NUEVO */}
      {showProductoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowProductoModal(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <h3 className="font-bold text-sm">Crear Producto en Catálogo</h3>
              <button onClick={() => setShowProductoModal(false)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <form onSubmit={handleSaveProducto} className="p-5 space-y-3 overflow-y-auto">
              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Nombre del Producto *</label>
                <input
                  type="text"
                  value={prodNombre}
                  onChange={e => setProdNombre(e.target.value)}
                  placeholder="Ej. Porta Bebés Ergonómico"
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-[var(--ac)]"
                  required
                />
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
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Stock Inicial en Bodega</label>
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
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Imagen del Producto (Opcional)</label>
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

      {/* MODAL 4: SCRIPT SQL SPRINT 10 */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowSqlModal(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl flex flex-col">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <Code size={18} className="text-emerald-500" />
                <h3 className="font-bold text-sm">Script SQL Sprint 10 — Reparación Catálogo, Inventario y Eliminación</h3>
              </div>
              <button onClick={() => setShowSqlModal(false)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="p-4 bg-sf rounded-xl border border-[var(--bd)] text-xs tx-mu space-y-1">
                <p className="font-semibold text-[var(--tx)]">Instrucciones para Supabase (1 sola vez):</p>
                <p>1. Copia el script de abajo y pégalo en tu <strong>Supabase SQL Editor</strong>.</p>
                <p>2. Presiona <strong>Run</strong>. Esto expone <code className="font-mono bg-cd px-1 rounded">public.record_movement</code>, permite borrar productos en cascada con <code className="font-mono bg-cd px-1 rounded">delete_inventory_product</code> y habilita <code className="font-mono bg-cd px-1 rounded">inventario_inicial</code> sin requerir compra.</p>
              </div>

              <div className="relative">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-mono tx-mu">docs/20261112_sprint10_catalog_inventory_fix.sql</span>
                  <button
                    onClick={copySql}
                    className="px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-sm"
                  >
                    {copiedSql ? <Check size={14} /> : <Copy size={14} />}
                    {copiedSql ? '¡Copiado!' : 'Copiar Script SQL'}
                  </button>
                </div>
                <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-200 font-mono text-xs overflow-x-auto max-h-96 border border-zinc-800 leading-relaxed">
                  {SPRINT10_SQL_CODE}
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
