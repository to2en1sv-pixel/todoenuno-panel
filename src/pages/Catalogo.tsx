import { useMemo, useState } from 'react';
import { useInventory, useProductos, useVariantes } from '@/hooks/useCatalog';
import { Skeleton } from '@/components/ui/Skeleton';
import { Package, Layers, Boxes } from 'lucide-react';

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
    <div className="max-w-5xl mx-auto flex flex-col gap-4 pb-10">
      
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex bg-sf bd rounded-lg p-1 gap-1">
          <button onClick={() => setTab('productos')} className="px-3 py-1.5 rounded-md text-sm font-semibold" style={tab === 'productos' ? { background: 'var(--cd)', border: '1px solid var(--bd)' } : { color: 'var(--mu)' }}>Productos</button>
          <button onClick={() => setTab('variantes')} className="px-3 py-1.5 rounded-md text-sm font-semibold" style={tab === 'variantes' ? { background: 'var(--cd)', border: '1px solid var(--bd)' } : { color: 'var(--mu)' }}>Variantes</button>
          <button onClick={() => setTab('inventario')} className="px-3 py-1.5 rounded-md text-sm font-semibold" style={tab === 'inventario' ? { background: 'var(--cd)', border: '1px solid var(--bd)' } : { color: 'var(--mu)' }}>Inventario</button>
        </div>
        <input 
          value={search} 
          onChange={(e) => setSearch(e.target.value)} 
          placeholder="Buscar..." 
          className="bg-cd bd rounded-lg px-3 py-2 text-sm outline-none flex-1 max-w-sm" 
        />
      </div>

      {tab === 'productos' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {productos.isLoading && <Skeleton h={100} />}
          {filteredProductos.map(p => (
            <div key={p.template_id} className="bg-cd bd rounded-xl overflow-hidden p-3 flex flex-col gap-2">
              {p.image_url ? <img src={p.image_url} className="w-full aspect-square object-cover rounded-lg" /> : <div className="w-full aspect-square bg-sf grid place-items-center rounded-lg text-3xl">📦</div>}
              <div>
                <div className="text-[10px] tx-mu mono">#{p.template_id}</div>
                <div className="font-semibold text-sm line-clamp-2">{p.nombre_base}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'variantes' && (
        <div className="bg-cd bd rounded-xl p-4 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left tx-mu mono text-[10px] uppercase">
                <th className="pb-2">SKU</th><th className="pb-2">Producto</th><th className="pb-2">Stock</th>
              </tr>
            </thead>
            <tbody>
              {filteredVariantes.map(v => (
                <tr key={v.variante_id} className="border-t" style={{ borderColor: 'var(--bd)' }}>
                  <td className="py-2 mono text-xs">{v.sku}</td>
                  <td className="text-xs">{v.nombre_completo}</td>
                  <td className="text-xs">{v.stock} uds</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'inventario' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(inv.data ?? []).map(x => (
            <div key={x.sku} className="bg-cd bd rounded-xl p-4">
              <div className="text-[10px] mono tx-mu truncate">{x.sku}</div>
              <div className="text-2xl font-bold mt-1">{x.qty}</div>
              <div className="text-[10px] tx-mu">{x.state}</div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
