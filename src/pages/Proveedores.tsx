import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase'; // Asegúrate de que esta ruta sea la correcta

type Proveedor = {
  id: string;
  nombre: string;
  telefono: string | null;
  etiquetas: string[];
};

export function ProveedoresPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modales
  const [isModalOpen, setIsModalOpen] = useState(false); // Modal Licitación
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false); // Modal Proveedor
  
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  // Form Licitación
  const [sku, setSku] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [imagenUrl, setImagenUrl] = useState('');
  const [precioRef, setPrecioRef] = useState('');
  const [precioMax, setPrecioMax] = useState('');
  const [modoPrueba, setModoPrueba] = useState(false);

  // Form Proveedor (Crear / Editar)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [provNombre, setProvNombre] = useState('');
  const [provTelefono, setProvTelefono] = useState('');
  const [provEtiquetas, setProvEtiquetas] = useState(''); // Se manejan separadas por coma

  useEffect(() => { void fetchProveedores(); }, []);

  async function fetchProveedores() {
    const { data } = await supabase.from('proveedores').select('*').order('nombre');
    if (data) setProveedores(data);
  }

  const filteredProveedores = proveedores.filter(p => 
    p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.telefono && p.telefono.includes(searchTerm))
  );

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredProveedores.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredProveedores.map(p => p.id)));
  };

  // --- LÓGICA DE PROVEEDORES (CREAR / EDITAR / ELIMINAR) ---
  function handleOpenNewProvider() {
    setEditingProviderId(null);
    setProvNombre('');
    setProvTelefono('');
    setProvEtiquetas('');
    setIsProviderModalOpen(true);
  }

  function handleOpenEditProvider(p: Proveedor) {
    setEditingProviderId(p.id);
    setProvNombre(p.nombre);
    setProvTelefono(p.telefono || '');
    setProvEtiquetas(p.etiquetas ? p.etiquetas.join(', ') : '');
    setIsProviderModalOpen(true);
  }

  async function handleSaveProvider() {
    if (!provNombre.trim()) return setMessage({ type: 'error', text: 'El nombre es obligatorio.' });
    
    setSaving(true);
    // Convertimos "VIP, Local" en ["VIP", "Local"]
    const etiquetasArray = provEtiquetas.split(',').map(t => t.trim()).filter(Boolean);

    const payload = {
      nombre: provNombre,
      telefono: provTelefono,
      etiquetas: etiquetasArray
    };

    let error;
    if (editingProviderId) {
      // Actualizar
      const res = await supabase.from('proveedores').update(payload).eq('id', editingProviderId);
      error = res.error;
    } else {
      // Crear
      const res = await supabase.from('proveedores').insert(payload);
      error = res.error;
    }

    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: 'Error al guardar: ' + error.message });
    } else {
      setMessage({ type: 'ok', text: `Proveedor ${editingProviderId ? 'actualizado' : 'creado'} correctamente.` });
      setIsProviderModalOpen(false);
      fetchProveedores();
    }
  }

  async function handleDeleteProvider(id: string) {
    if (!window.confirm('¿Estás seguro de eliminar este proveedor?')) return;
    
    const { error } = await supabase.from('proveedores').delete().eq('id', id);
    if (error) {
      setMessage({ type: 'error', text: 'Error al eliminar: ' + error.message });
    } else {
      setMessage({ type: 'ok', text: 'Proveedor eliminado.' });
      fetchProveedores();
    }
  }

  // --- LÓGICA DE LICITACIÓN ---
  async function handleGuardarLicitacion() {
    if (selectedIds.size === 0 && !modoPrueba) {
      return setMessage({ type: 'error', text: 'Seleccioná al menos un proveedor o activá Modo Prueba.' });
    }

    setSaving(true);
    setMessage(null);

    const { data: licitacion, error: errLicitacion } = await supabase
      .from('licitaciones')
      .insert({
        sku, cantidad: Number(cantidad),
        imagen_url: imagenUrl || null,
        precio_referencia: precioRef ? Number(precioRef) : null,
        precio_maximo: precioMax ? Number(precioMax) : null,
        modo_prueba: modoPrueba,
        estado: 'pending'
      }).select().single();

    if (errLicitacion || !licitacion) {
      setSaving(false);
      return setMessage({ type: 'error', text: errLicitacion?.message || 'Error al crear la licitación' });
    }

    let queueData = [];
    
    if (modoPrueba) {
      const { data: testProvider } = await supabase.from('proveedores').select('id').ilike('nombre', '%TEST%').limit(1).single();
      if (testProvider) queueData.push({ licitacion_id: licitacion.id, proveedor_id: testProvider.id });
      else {
        const fallback = proveedores[0];
        if(fallback) queueData.push({ licitacion_id: licitacion.id, proveedor_id: fallback.id });
      }
    } else {
      queueData = Array.from(selectedIds).map(id => ({ licitacion_id: licitacion.id, proveedor_id: id }));
    }

    if (queueData.length > 0) {
      await supabase.from('licitacion_proveedores').insert(queueData);
    }

    setSaving(false);
    setIsModalOpen(false);
    setSelectedIds(new Set());
    setMessage({ type: 'ok', text: 'Licitación encolada. El sistema enviará en lotes de 5 cada 10 min.' });
    
    setSku(''); setCantidad('1'); setImagenUrl(''); setPrecioRef(''); setPrecioMax(''); setModoPrueba(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Red de Proveedores</h1>
            <p className="text-sm text-slate-500">Gestión masiva para licitaciones.</p>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={handleOpenNewProvider} 
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors flex items-center gap-2"
            >
              + Proveedor
            </button>

            <button 
              onClick={() => setIsModalOpen(true)} 
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
            >
              Lanzar Licitación ({selectedIds.size})
            </button>
          </div>
        </div>

        {message && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
            {message.text}
          </div>
        )}

        <div className="mb-4 flex gap-4">
          <input 
            type="text" placeholder="Buscar por nombre o teléfono..." 
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500 bg-white"
          />
        </div>

        {/* TABLA DE PROVEEDORES */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 w-12 text-left">
                  <input 
                    type="checkbox" 
                    onChange={toggleSelectAll} 
                    checked={selectedIds.size === filteredProveedores.length && filteredProveedores.length > 0} 
                    className="rounded border-slate-300 text-orange-500 focus:ring-orange-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Proveedor</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Teléfono</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Etiquetas</th>
                <th className="px-4 py-3 text-right font-medium text-slate-500">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProveedores.map(p => (
                <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${selectedIds.has(p.id) ? 'bg-orange-50' : ''}`}>
                  <td className="px-4 py-3">
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(p.id)} 
                      onChange={() => toggleSelect(p.id)}
                      className="rounded border-slate-300 text-orange-500 focus:ring-orange-500 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">{p.nombre}</td>
                  <td className="px-4 py-3 text-slate-600">{p.telefono || '—'}</td>
                  <td className="px-4 py-3">
                    {p.etiquetas?.map(tag => (
                      <span key={tag} className="mr-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {tag}
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleOpenEditProvider(p)} className="text-slate-400 hover:text-blue-600 mr-3 transition-colors" title="Editar">
                      ✏️
                    </button>
                    <button onClick={() => handleDeleteProvider(p.id)} className="text-slate-400 hover:text-red-600 transition-colors" title="Eliminar">
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
              {filteredProveedores.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No se encontraron proveedores.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL LICITACIÓN */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Nueva Licitación</h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-700">SKU *</label>
                  <input value={sku} onChange={e => setSku(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm outline-none focus:border-orange-500" placeholder="Ej: SKU-123" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Cantidad *</label>
                  <input type="number" min="1" value={cantidad} onChange={e => setCantidad(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm outline-none focus:border-orange-500" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">URL Imagen (Opcional)</label>
                <input value={imagenUrl} onChange={e => setImagenUrl(e.target.value)} placeholder="https://..." className="mt-1 w-full rounded-lg border p-2 text-sm outline-none focus:border-orange-500" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-700">Precio Ref (Opcional)</label>
                  <input type="number" min="0" step="0.01" value={precioRef} onChange={e => setPrecioRef(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm outline-none focus:border-orange-500" placeholder="0.00" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Precio Máx (Opcional)</label>
                  <input type="number" min="0" step="0.01" value={precioMax} onChange={e => setPrecioMax(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm outline-none focus:border-orange-500" placeholder="0.00" />
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                <input type="checkbox" id="modoPrueba" checked={modoPrueba} onChange={e => setModoPrueba(e.target.checked)} className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500 cursor-pointer" />
                <label htmlFor="modoPrueba" className="text-sm font-medium text-amber-800 cursor-pointer">
                  Modo Prueba (Envía solo al proveedor "TEST")
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setIsModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
                Cancelar
              </button>
              <button onClick={handleGuardarLicitacion} disabled={saving} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors">
                {saving ? 'Guardando...' : 'Encolar Envíos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CREAR/EDITAR PROVEEDOR */}
      {isProviderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              {editingProviderId ? 'Editar Proveedor' : 'Nuevo Proveedor'}
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-700">Nombre *</label>
                <input value={provNombre} onChange={e => setProvNombre(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm outline-none focus:border-orange-500" placeholder="Ej: BoomBuy" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Teléfono</label>
                <input value={provTelefono} onChange={e => setProvTelefono(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm outline-none focus:border-orange-500" placeholder="Ej: +503 7777 8888" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Etiquetas (separadas por coma)</label>
                <input value={provEtiquetas} onChange={e => setProvEtiquetas(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm outline-none focus:border-orange-500" placeholder="Ej: VIP, Mayorista, San Salvador" />
                <p className="text-[11px] text-slate-400 mt-1">Esto te ayudará a buscar y filtrar después.</p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setIsProviderModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
                Cancelar
              </button>
              <button onClick={handleSaveProvider} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 transition-colors">
                {saving ? 'Guardando...' : 'Guardar Proveedor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
