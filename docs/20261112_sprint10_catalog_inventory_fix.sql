-- ============================================================================
-- TODOENUNO OS — SPRINT 10: REPARACIÓN Y CONEXIÓN TOTAL DE CATÁLOGO E INVENTARIO
-- Ejecutar en: Supabase SQL Editor
--
-- Soluciona:
-- 1. Expone public.record_movement(...) como RPC accesible desde el frontend.
-- 2. Permite eliminar productos en cascada (ON DELETE CASCADE en kardex + RPC).
-- 3. Agrega tipo 'inventario_inicial' para meter stock real sin registrar compra.
-- 4. Aloja campos de Bot Todd y categoría directamente en inventory.stock.
-- 5. Otorga permisos SELECT, INSERT, UPDATE, DELETE y RLS completos.
-- ============================================================================

create schema if not exists inventory;

-- 1. Asegurar tabla maestra inventory.stock con todos los campos modernos
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

-- Asegurar columnas nuevas si la tabla ya existía del Sprint 3
alter table inventory.stock
  add column if not exists todd_pitch text default '',
  add column if not exists todd_instrucciones text default '',
  add column if not exists todd_keywords text default '',
  add column if not exists activo_todd boolean not null default true,
  add column if not exists categoria text default 'General';

create index if not exists inventory_stock_disponible_idx on inventory.stock (stock_disponible);
create index if not exists inventory_stock_template_idx   on inventory.stock (template_id);

-- 2. Asegurar tabla inventory.kardex con ON DELETE CASCADE y tipo 'inventario_inicial'
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

-- Actualizar constraint de tipo_movimiento para aceptar 'inventario_inicial'
do $$
declare
  v_con_name text;
begin
  -- Quitar check viejo de tipo_movimiento si existe
  for v_con_name in
    select conname
    from pg_constraint
    where conrelid = 'inventory.kardex'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%tipo_movimiento%'
  loop
    execute format('alter table inventory.kardex drop constraint if exists %I', v_con_name);
  end loop;

  alter table inventory.kardex
    add constraint kardex_tipo_movimiento_check
    check (tipo_movimiento in (
      'inventario_inicial',
      'compra_entrada',
      'venta_salida',
      'reserva_pedido',
      'devolucion_entrada',
      'ajuste_positivo',
      'ajuste_negativo',
      'merma_dano'
    ));

  -- Reemplazar FK hacia inventory.stock para asegurar ON DELETE CASCADE
  for v_con_name in
    select conname
    from pg_constraint
    where conrelid = 'inventory.kardex'::regclass
      and contype = 'f'
  loop
    execute format('alter table inventory.kardex drop constraint if exists %I', v_con_name);
  end loop;

  alter table inventory.kardex
    add constraint kardex_sku_fkey
    foreign key (sku) references inventory.stock(sku)
    on update cascade on delete cascade;
end;
$$;

create index if not exists inventory_kardex_sku_idx        on inventory.kardex (sku);
create index if not exists inventory_kardex_tipo_idx       on inventory.kardex (tipo_movimiento);
create index if not exists inventory_kardex_created_at_idx on inventory.kardex (created_at desc);

-- 3. Función central atómica en esquema inventory
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
  v_sku_clean text;
  v_stock_actual integer;
  v_reservado_actual integer;
  v_nuevo_fisico integer;
  v_nuevo_reservado integer;
  v_delta integer;
  v_kardex_id bigint;
begin
  v_sku_clean := upper(trim(p_sku));

  -- Asegurar que el SKU exista en inventory.stock
  insert into inventory.stock (sku, nombre, stock_fisico, created_at)
  values (v_sku_clean, v_sku_clean, 0, now())
  on conflict (sku) do nothing;

  select stock_fisico, stock_reservado
    into v_stock_actual, v_reservado_actual
    from inventory.stock
   where sku = v_sku_clean
     for update;

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
     set stock_fisico    = v_nuevo_fisico,
         stock_reservado = v_nuevo_reservado,
         updated_at      = now()
   where sku = v_sku_clean;

  insert into inventory.kardex (
    sku, tipo_movimiento, cantidad, costo_unitario, saldo_fisico, motivo, source_table, source_id, usuario
  ) values (
    v_sku_clean, p_tipo_movimiento, v_delta, coalesce(p_costo_unitario, 0.00),
    v_nuevo_fisico, coalesce(nullif(trim(p_motivo), ''), p_tipo_movimiento),
    p_source_table, p_source_id, p_usuario
  ) returning id into v_kardex_id;

  return jsonb_build_object(
    'success', true,
    'kardex_id', v_kardex_id,
    'sku', v_sku_clean,
    'saldo_fisico', v_nuevo_fisico,
    'saldo_reservado', v_nuevo_reservado,
    'saldo_disponible', greatest(v_nuevo_fisico - v_nuevo_reservado, 0)
  );
end;
$$;

-- 4. CRÍTICO: Wrapper en esquema PUBLIC para que supabase.rpc('record_movement') funcione siempre
create or replace function public.record_movement(
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
begin
  return inventory.record_movement(
    p_sku, p_tipo_movimiento, p_cantidad, p_costo_unitario,
    p_motivo, p_source_table, p_source_id, p_usuario
  );
end;
$$;

-- 5. RPC para eliminación limpia y atómica de un producto (sin errores de FK o RLS)
create or replace function public.delete_inventory_product(
  p_sku         text default null,
  p_template_id text default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_sku_clean text;
begin
  v_sku_clean := nullif(upper(trim(coalesce(p_sku, ''))), '');

  -- 1. Si hay SKU, eliminar de inventory.kardex, inventory.stock e inventory_cache
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

  -- 2. Si hay template_id, limpiar también en tablas legacy productos / productos_variantes
  if p_template_id is not null and trim(p_template_id) <> '' then
    delete from inventory.stock where template_id = p_template_id;

    if exists (select from pg_tables where schemaname = 'public' and tablename = 'productos_variantes') then
      execute 'delete from public.productos_variantes where template_id::text = $1' using p_template_id;
    end if;

    if exists (select from pg_tables where schemaname = 'public' and tablename = 'productos') then
      execute 'delete from public.productos where template_id::text = $1' using p_template_id;
    end if;
  end if;

  return jsonb_build_object('success', true, 'sku', v_sku_clean, 'template_id', p_template_id);
end;
$$;

-- 6. Recrear vistas públicas actualizadas (con todas las columnas nuevas)
drop view if exists public.inventory_stock;
drop view if exists public.inventory_kardex;

create or replace view public.inventory_stock as select * from inventory.stock;
create or replace view public.inventory_kardex as select * from inventory.kardex;

-- 7. Permisos completos (SELECT, INSERT, UPDATE, DELETE) y RLS permisivo
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

-- Asegurar permisos en tablas legacy si existen
do $$
begin
  if exists (select from pg_tables where schemaname = 'public' and tablename = 'productos') then
    alter table public.productos
      add column if not exists todd_pitch text default '',
      add column if not exists todd_instrucciones text default '',
      add column if not exists todd_keywords text default '',
      add column if not exists activo_todd boolean default true;

    grant select, insert, update, delete on public.productos to anon, authenticated, service_role;
  end if;

  if exists (select from pg_tables where schemaname = 'public' and tablename = 'productos_variantes') then
    grant select, insert, update, delete on public.productos_variantes to anon, authenticated, service_role;
  end if;

  if exists (select from pg_tables where schemaname = 'public' and tablename = 'inventory_cache') then
    grant select, insert, update, delete on public.inventory_cache to anon, authenticated, service_role;
  end if;
end;
$$;

select 'Sprint 10: Catálogo e Inventario Nativo reparados y conectados exitosamente' as resultado;
