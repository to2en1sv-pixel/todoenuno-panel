import { useState, useMemo } from 'react';
import { useProductos, useVariantes, useInventory } from '@/hooks/useCatalog';
import { Search, Package, AlertTriangle, X } from 'lucide-react';

export function CatalogoPage() {
  const productos = useProductos();
  const variantes = useVariantes();
  const inv = useInventory();

  const [tab, setTab] = useState<'productos' | 'inventario'>('productos');
  const [search, setSearch] = useState('');
  const [filterStock, setFilterStock] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // 1. Lógica para filtrar productos
  const filteredProductos = useMemo(() => {
    let list = productos.data ?? [];
    
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => 
        (p.nombre_base || '').toLowerCase().includes(q) || 
        p.template_id.toString().includes(q)
      );
    }
    
    // Si el filtro de stock está activo, solo mostramos productos con variantes en alerta
    if (filterStock) {
      const lowStockSkus = new Set(inv.data?.filter(i => i.qty <= 5).map(i => i.sku));
      const productosConAlerta = new Set(
        variantes.data?.filter(v => v.sku && lowStockSkus.has(v.sku)).map(v => v.template_id)
      );
      list = list.filter(p => productosConAlerta.has(p.template_id));
    }
    
    return list;
  }, [productos.data, variantes.data, inv.data, search, filterStock]);

  // 2. Lógica para el inventario (buscador)
  const filteredInventory = useMemo(() => {
    let list = inv.data ?? [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.sku.toLowerCase().includes(q));
    }
    if (filterStock) {
      list = list.filter(i => i.qty <= 5);
    }
    return list;
  }, [inv.data, search, filterStock]);

  // Obtener variantes del producto seleccionado
  const productVariants = useMemo(() => {
    if (!selectedProduct) return [];
    return (variantes.data ?? []).filter(v => v.template_id === selectedProduct.template_id);
  }, [variantes.data, selectedProduct]);

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10 h-full">
      
      {/* Barra de Herramientas */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-3 bg-cd p-3 rounded-xl border border-[var(--bd)]">
        <div className="flex bg-sf p-1 rounded-lg w-full sm:w-auto">
          <button 
            onClick={() => setTab('productos')} 
            className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${tab === 'productos' ? 'bg-cd shadow-sm text-[var(--tx)]' : 'text-[var(--mu)]'}`}
          >
            Productos
          </button>
          <button 
            onClick={() => setTab('inventario')} 
            className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${tab === 'inventario' ? 'bg-cd shadow-sm text-[var(--tx)]' : 'text-[var(--mu)]'}`}
          >
            Inventario
          </button>
        </div>

        <div className="flex flex-1 items-center gap-2 w-full sm:max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mu)]" size={16} />
            <input 
              type="text"
              placeholder="Buscar por nombre o SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-sf border border-[var(--bd)] rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-[var(--ac)]"
            />
          </div>
          
          <button 
            onClick={() => setFilterStock(!filterStock)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors whitespace-nowrap ${
              filterStock 
                ? 'bg-orange-100 border-orange-300 text-orange-700' 
                : 'bg-cd border-[var(--bd)] text-[var(--mu)] hover:bg-sf'
            }`}
          >
            <AlertTriangle size={16} /> Stock Bajo
          </button>
        </div>
      </div>

      {/* CONTENIDO: Pestaña Productos */}
      {tab === 'productos' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {productos.isLoading && <div className="col-span-full text-center p-8 tx-mu">Cargando catálogo...</div>}
          {!productos.isLoading && filteredProductos.length === 0 && (
            <div className="col-span-full text-center p-8 tx-mu">No se encontraron productos con estos filtros.</div>
          )}
          {filteredProductos.map(p => (
            <div 
              key={p.template_id} 
              onClick={() => setSelectedProduct(p)}
              className="bg-cd border border-[var(--bd)] rounded-xl p-3 flex flex-col gap-2 cursor-pointer hover:border-[var(--ac)] hover:shadow-md transition-all group"
            >
              <div className="aspect-square bg-sf rounded-lg overflow-hidden relative">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.nombre_base || ''} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-3xl">📦</div>
                )}
                {!p.active && (
                  <div className="absolute top-2 right-2 bg-red-100 text-red-700 text-[10px] font-bold px-2 py-1 rounded-md border border-red-200">Inactivo</div>
                )}
              </div>
              <div>
                <div className="text-[10px] mono text-[var(--mu)]">#{p.template_id}</div>
                <div className="font-semibold text-sm line-clamp-2 leading-tight">{p.nombre_base}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CONTENIDO: Pestaña Inventario */}
      {tab === 'inventario' && (
        <div className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-sf border-b border-[var(--bd)] text-[var(--mu)] text-xs uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">SKU</th>
                <th className="px-4 py-3 font-semibold">Estado Odoo</th>
                <th className="px-4 py-3 font-semibold text-right">Stock</th>
              </tr>
            </thead>
            <tbody>
              {inv.isLoading && <tr><td colSpan={3} className="text-center p-4 text-[var(--mu)]">Cargando inventario...</td></tr>}
              {!inv.isLoading && filteredInventory.length === 0 && <tr><td colSpan={3} className="text-center p-4 text-[var(--mu)]">No hay SKUs que coincidan.</td></tr>}
              {filteredInventory.map(i => (
                <tr key={i.sku} className="border-b border-[var(--bd)] last:border-0 hover:bg-sf">
                  <td className="px-4 py-3 mono text-xs">{i.sku}</td>
                  <td className="px-4 py-3 text-xs">{i.state}</td>
                  <td className={`px-4 py-3 font-bold text-right ${i.qty <= 0 ? 'text-red-500' : i.qty <= 5 ? 'text-orange-500' : 'text-green-600'}`}>
                    {i.qty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* DRAWER (Panel Lateral de Producto) */}
      {selectedProduct && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40 transition-opacity" onClick={() => setSelectedProduct(null)} />
          <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[400px] bg-cd z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            
            <div className="p-4 border-b border-[var(--bd)] flex justify-between items-center bg-sf">
              <h2 className="font-bold">Detalle del Producto</h2>
              <button onClick={() => setSelectedProduct(null)} className="p-2 hover:bg-gray-200 rounded-lg"><X size={20}/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              <div className="flex gap-4">
                {selectedProduct.image_url ? (
                  <img src={selectedProduct.image_url} className="w-24 h-24 rounded-lg object-cover bg-sf" />
                ) : (
                  <div className="w-24 h-24 rounded-lg bg-sf flex items-center justify-center text-3xl">📦</div>
                )}
                <div>
                  <div className="text-[11px] mono text-[var(--mu)]">#{selectedProduct.template_id}</div>
                  <h3 className="font-bold text-lg leading-tight">{selectedProduct.nombre_base}</h3>
                  <div className="flex gap-2 mt-2">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${selectedProduct.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {selectedProduct.active ? 'Activo' : 'Inactivo'}
                    </span>
                    {selectedProduct.is_published && (
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-700">Publicado</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
                  <Package size={16} /> Variantes ({productVariants.length})
                </h4>
                <div className="flex flex-col gap-2">
                  {productVariants.length === 0 && <div className="text-xs text-[var(--mu)]">Sin variantes registradas.</div>}
                  {productVariants.map(v => {
                    const stockReal = inv.data?.find(i => i.sku === v.sku)?.qty ?? v.stock ?? 0;
                    return (
                      <div key={v.variante_id} className="flex justify-between items-center p-3 bg-sf border border-[var(--bd)] rounded-lg">
                        <div>
                          <div className="mono text-xs font-semibold">{v.sku}</div>
                          <div className="text-[11px] text-[var(--mu)] mt-0.5">
                            {[v.color, v.talla].filter(Boolean).join(' • ') || 'Estándar'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-sm">${v.precio?.toFixed(2)}</div>
                          <div className={`text-[10px] font-bold ${stockReal <= 0 ? 'text-red-500' : stockReal <= 5 ? 'text-orange-500' : 'text-green-600'}`}>
                            {stockReal} en stock
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
