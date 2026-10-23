import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tabs } from '@/components/ui/Tabs';
import { useInventory, useProductos, useVariantes } from '@/hooks/useCatalog';
import { fmtMoney, fmtNum } from '@/lib/format';

type Tab = 'productos' | 'variantes' | 'inventario';

export function CatalogoPage() {
  const [tab, setTab] = useState<Tab>('productos');
  const [search, setSearch] = useState('');
  const productos = useProductos();
  const variantes = useVariantes();
  const inv = useInventory();

  const filteredProductos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return productos.data ?? [];
    return (productos.data ?? []).filter((p) =>
      (p.nombre_base ?? '').toLowerCase().includes(q) || String(p.template_id).includes(q)
    );
  }, [productos.data, search]);

  const filteredVariantes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return variantes.data ?? [];
    return (variantes.data ?? []).filter((v) =>
      [v.sku, v.nombre_completo, v.color, v.talla].filter(Boolean).some((s) => (s as string).toLowerCase().includes(q))
    );
  }, [variantes.data, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { key: 'productos',  label: `Productos (${productos.data?.length ?? 0})` },
            { key: 'variantes',  label: `Variantes (${variantes.data?.length ?? 0})` },
            { key: 'inventario', label: `Inventario (${inv.data?.length ?? 0})` },
          ]}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, SKU…"
          className="bg-cd bd rounded-lg px-3 py-2 text-sm outline-none flex-1 max-w-sm"
        />
      </div>

      {tab === 'productos' && (
        <Card>
          {productos.isLoading && <Skeleton h={200} />}
          {!productos.isLoading && filteredProductos.length === 0 && (
            <EmptyState title="Sin productos" hint="Se poblarán al correr el sync de Odoo." />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredProductos.map((p) => (
              <div key={p.template_id} className="bg-sf bd rounded-lg p-3 flex gap-3">
                {p.image_url ? (
                  <img src={p.image_url} alt="" className="w-14 h-14 rounded object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded grid place-items-center text-xl bg-cd bd">📦</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] mono tx-mu">#{p.template_id}</div>
                  <div className="font-semibold text-sm truncate">{p.nombre_base ?? '—'}</div>
                  <div className="flex gap-1 mt-1">
                    {p.active ? <Badge tone="ok">activo</Badge> : <Badge>inactivo</Badge>}
                    {p.is_published ? <Badge tone="ac">publicado</Badge> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'variantes' && (
        <Card className="overflow-auto">
          {variantes.isLoading && <Skeleton h={200} />}
          {!variantes.isLoading && filteredVariantes.length === 0 && (
            <EmptyState title="Sin variantes" />
          )}
          {filteredVariantes.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left tx-mu mono text-[11px]">
                  <th className="py-2 px-2">SKU</th>
                  <th>Producto</th>
                  <th>Color / Talla</th>
                  <th>Precio</th>
                  <th>Stock</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filteredVariantes.map((v) => (
                  <tr key={v.variante_id} className="border-t" style={{ borderColor: 'var(--bd)' }}>
                    <td className="py-2 px-2 mono text-xs">{v.sku ?? '—'}</td>
                    <td className="text-xs">{v.nombre_completo ?? '—'}</td>
                    <td className="text-xs">{[v.color, v.talla].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="mono text-xs">{fmtMoney(v.precio)}</td>
                    <td className="mono text-xs">{fmtNum(v.stock)}</td>
                    <td><Badge tone={(v.estado ?? '').toLowerCase() === 'activo' ? 'ok' : 'neutral'}>{v.estado ?? '—'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'inventario' && (
        <Card>
          {inv.isLoading && <Skeleton h={200} />}
          {!inv.isLoading && (inv.data ?? []).length === 0 && <EmptyState title="Sin inventario" />}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(inv.data ?? []).map((x) => {
              const tone = x.qty <= 0 ? 'er' : x.qty <= 5 ? 'ac' : 'ok';
              return (
                <div key={x.sku} className="bg-sf bd rounded-lg p-3">
                  <div className="text-[11px] mono tx-mu truncate">{x.sku}</div>
                  <div className="text-xl font-bold">{fmtNum(x.qty)}</div>
                  <div className="text-[11px] tx-mu flex items-center gap-1">
                    <span className={`dot ${tone}`} />{x.state}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
