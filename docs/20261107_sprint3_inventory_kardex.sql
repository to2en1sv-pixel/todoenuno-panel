-- ============================================================================
-- TODOENUNO OS — SPRINT 3: INVENTARIO NATIVO & KÁRDEX ENGINE (DESACOPLE DE ODOO)
-- Ejecutar en: Supabase SQL Editor
--
-- Objetivos:
-- 1. Independizar el inventario de Odoo convirtiendo a Supabase en la única fuente de la verdad.
-- 2. Manejo de Kárdex inmutable de entradas y salidas con saldo resultante.
-- 3. Control de Stock Físico, Stock Reservado (en pedidos activos) y Stock Disponible.
-- 4. Cálculo del Costo Unitario Real (COGS) por producto para utilidad neta exacta.
-- ============================================================================

create schema if not exists inventory;

-- 1. Tabla Maestra de Stock por SKU
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

create index if not exists inventory_stock_disponible_idx on inventory.stock (stock_disponible);
create index if not exists inventory_stock_template_idx   on inventory.stock (template_id);

-- 2. Tabla Inmutable de Kárdex (Libro Mayor de Movimientos)
create table if not exists inventory.kardex (
  id               bigint generated always as identity primary key,
  sku              text not null references inventory.stock(sku) on update cascade,
  tipo_movimiento  text not null check (tipo_movimiento in (
    'compra_entrada',     -- Entrada por compra a proveedor (+ Físico)
    'venta_salida',       -- Salida definitiva por pedido entregado (- Físico, - Reservado)
    'reserva_pedido',     -- Reserva temporal por pedido confirmado (+ Reservado)
    'devolucion_entrada', -- Retorno a bodega por pedido cancelado/devuelto (+ Físico o - Reservado)
    'ajuste_positivo',    -- Conteo físico mayor (+ Físico)
    'ajuste_negativo',    -- Conteo físico menor (- Físico)
    'merma_dano'          -- Producto dañado o muestra (- Físico)
  )),
  cantidad         integer not null, -- Positivo o negativo según la naturaleza
  costo_unitario   numeric(10,2) not null default 0.00,
  saldo_fisico     integer not null,
  motivo           text not null,
  source_table     text, -- 'whatsapp_orders', 'finance.money_transactions', 'manual'
  source_id        text, -- ID de orden o comprobante
  usuario          text default 'Sistema',
  created_at       timestamptz not null default now()
);

create index if not exists inventory_kardex_sku_idx        on inventory.kardex (sku);
create index if not exists inventory_kardex_tipo_idx       on inventory.kardex (tipo_movimiento);
create index if not exists inventory_kardex_created_at_idx on inventory.kardex (created_at desc);

-- 3. Migración Automática Inicial: Poblar inventory.stock desde inventory_cache y productos si existen
do $$
begin
  -- Si existe inventory_cache, poblamos el stock inicial agrupando por SKU para evitar duplicados
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

  -- Si existen productos_variantes sin stock en cache, los agregamos con 0
  if exists (select from pg_tables where schemaname = 'public' and tablename = 'productos_variantes') then
    insert into inventory.stock (sku, nombre, precio_venta, template_id)
    select 
      pv.sku,
      coalesce(max(p.nombre_base), pv.sku) as nombre,
      coalesce(max(pv.precio), 0.00) as precio_venta,
      max(pv.template_id::text) as template_id
    from public.productos_variantes pv
    left join public.productos p on p.template_id = pv.template_id
    where pv.sku is not null and trim(pv.sku) <> ''
    group by pv.sku
    on conflict (sku) do update set
      precio_venta = coalesce(excluded.precio_venta, inventory.stock.precio_venta),
      template_id  = coalesce(excluded.template_id, inventory.stock.template_id);
  end if;
end;
$$;

-- 4. Función de Operación del Kárdex (Registrar Movimiento y Actualizar Stock Atómicamente)
create or replace function inventory.record_movement(
  p_sku             text,
  p_tipo_movimiento text,
  p_cantidad        integer,
  p_costo_unitario  numeric default 0.00,
  p_motivo          text default '',
  p_source_table    text default 'manual',
  p_source_id       text default null,
  p_usuario         text default 'Panel Admin'
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_stock_actual integer;
  v_reservado_actual integer;
  v_nuevo_fisico integer;
  v_nuevo_reservado integer;
  v_kardex_id bigint;
begin
  -- Asegurar que el SKU exista en el stock
  insert into inventory.stock (sku, nombre, stock_fisico, created_at)
  values (p_sku, p_sku, 0, now())
  on conflict (sku) do nothing;

  -- Bloquear fila para actualización atómica concurrente
  select stock_fisico, stock_reservado
    into v_stock_actual, v_reservado_actual
    from inventory.stock
   where sku = p_sku
     for update;

  v_nuevo_fisico    := v_stock_actual;
  v_nuevo_reservado := v_reservado_actual;

  -- Calcular según el tipo de movimiento
  if p_tipo_movimiento in ('compra_entrada', 'ajuste_positivo') then
    v_nuevo_fisico := v_stock_actual + abs(p_cantidad);
    
    -- Actualizar costo unitario promedio si es compra con costo > 0
    if p_tipo_movimiento = 'compra_entrada' and p_costo_unitario > 0 then
      update inventory.stock
         set costo_unitario = p_costo_unitario
       where sku = p_sku;
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
    -- El producto regresa a bodega
    v_nuevo_fisico    := v_stock_actual + abs(p_cantidad);
  end if;

  -- Actualizar stock
  update inventory.stock
     set stock_fisico    = v_nuevo_fisico,
         stock_reservado = v_nuevo_reservado,
         updated_at      = now()
   where sku = p_sku;

  -- Insertar registro inmutable de Kárdex
  insert into inventory.kardex (
    sku, tipo_movimiento, cantidad, costo_unitario, saldo_fisico, motivo, source_table, source_id, usuario
  ) values (
    p_sku, p_tipo_movimiento, p_cantidad, coalesce(p_costo_unitario, 0.00),
    v_nuevo_fisico, p_motivo, p_source_table, p_source_id, p_usuario
  ) returning id into v_kardex_id;

  return jsonb_build_object(
    'success', true,
    'kardex_id', v_kardex_id,
    'sku', p_sku,
    'saldo_fisico', v_nuevo_fisico,
    'saldo_reservado', v_nuevo_reservado,
    'saldo_disponible', greatest(v_nuevo_fisico - v_nuevo_reservado, 0)
  );
end;
$$;

-- 5. Trigger sobre os.events para procesar pedidos automáticamente
create or replace function inventory.project_order_events() returns trigger
language plpgsql
security definer
as $$
declare
  v_sku text;
  v_qty integer;
begin
  v_sku := coalesce(NEW.payload->>'sku', '');
  v_qty := coalesce((NEW.payload->>'cantidad')::integer, 1);

  if v_sku <> '' and v_sku is not null then
    -- Pedido confirmado / por empacar: Reserva la unidad
    if NEW.type = 'order.confirmed' then
      perform inventory.record_movement(
        v_sku, 'reserva_pedido', v_qty, 0.00,
        'Reserva pedido ' || coalesce(NEW.payload->>'pedido_codigo', NEW.source_id),
        'whatsapp_orders', NEW.source_id, 'OS Trigger'
      );

    -- Pedido entregado: Salida definitiva de stock y deducción de reserva
    elsif NEW.type = 'order.delivered' then
      perform inventory.record_movement(
        v_sku, 'venta_salida', v_qty, 0.00,
        'Entrega liquidada pedido ' || coalesce(NEW.payload->>'pedido_codigo', NEW.source_id),
        'whatsapp_orders', NEW.source_id, 'OS Trigger'
      );

    -- Pedido cancelado: Liberación de reserva
    elsif NEW.type = 'order.cancelled' then
      perform inventory.record_movement(
        v_sku, 'devolucion_entrada', v_qty, 0.00,
        'Cancelación pedido ' || coalesce(NEW.payload->>'pedido_codigo', NEW.source_id),
        'whatsapp_orders', NEW.source_id, 'OS Trigger'
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_inventory_order_events on os.events;
create trigger trg_inventory_order_events
  after insert on os.events
  for each row execute function inventory.project_order_events();

-- 6. Vistas en esquema public para PostgREST API
create or replace view public.inventory_stock as select * from inventory.stock;
create or replace view public.inventory_kardex as select * from inventory.kardex;

-- 7. Permisos y RLS
alter table inventory.stock  enable row level security;
alter table inventory.kardex enable row level security;

grant usage on schema inventory to anon, authenticated, service_role;
grant select, insert, update on inventory.stock to anon, authenticated, service_role;
grant select, insert on inventory.kardex to anon, authenticated, service_role;

grant select, insert, update on public.inventory_stock to anon, authenticated, service_role;
grant select, insert on public.inventory_kardex to anon, authenticated, service_role;

drop policy if exists "inventory_stock_all"  on inventory.stock;
drop policy if exists "inventory_kardex_all" on inventory.kardex;

create policy "inventory_stock_all"  on inventory.stock  for all using (true) with check (true);
create policy "inventory_kardex_all" on inventory.kardex for all using (true) with check (true);

grant execute on function inventory.record_movement to anon, authenticated, service_role;

select 'Inventario Nativo y Motor de Kárdex instalado exitosamente' as resultado;
