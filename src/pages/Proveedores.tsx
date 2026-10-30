import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase'; // Ajustá tu ruta

type Proveedor = {
  id: string;
  nombre: string;
  telefono: string | null;
  etiquetas: string[];
};

export default function Proveedores() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  // Form State
  const [sku, setSku] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [imagenUrl, setImagenUrl] = useState('');
  const [precioRef, setPrecioRef] = useState('');
  const [precioMax, setPrecioMax] = useState('');
  const [modoPrueba, setModoPrueba] = useState(false);

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

  async function handleGuardarLicitacion() {
    if (selectedIds.size === 0 && !modoPrueba) {
      return setMessage({ type: 'error', text: 'Seleccioná al menos un proveedor o activá Modo Prueba.' });
    }

    setSaving(true);
    setMessage(null);

    // 1. Crear la licitación
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
      return setMessage({ type: 'error', text: errLicitacion?.message || 'Error al crear' });
    }

    // 2. Crear la cola de envíos (licitacion_proveedores)
    let queueData = [];
    
    if (modoPrueba) {
      // Buscamos un proveedor ficticio de prueba (o lo mandamos a tu número)
      const { data: testProvider } = await supabase.from('proveedores').select('id').ilike('nombre', '%TEST%').limit(1).single();
      if (testProvider) queueData.push({ licitacion_id: licitacion.id, proveedor_id: testProvider.id });
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
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Red de Proveedores</h1>
            <p className="text-sm text-slate-500">Gestión masiva para licitaciones.</p>
          </div>
          <button onClick={() => setIsModalOpen(true)} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600">
            Lanzar Licitación ({selectedIds.size})
          </button>
        </div>

        {message && <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === 'ok' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{message.text}</div>}

        {/* Buscador y Filtros */}
        <div className="mb-4 flex gap-4">
          <input 
            type="text" placeholder="Buscar por nombre o teléfono..." 
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {/* Tabla */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 w-12">
                  <input type="checkbox" onChange={toggleSelectAll} checked={selectedIds.size === filteredProveedores.length && filteredProveedores.length > 0} />
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Proveedor</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Teléfono</th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">Etiquetas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProveedores.map(p => (
                <tr key={p.id} className={`hover:bg-slate-50 ${selectedIds.has(p.id) ? 'bg-orange-50' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">{p.nombre}</td>
                  <td className="px-4 py-3 text-slate-600">{p.telefono || '—'}</td>
                  <td className="px-4 py-3">
                    {p.etiquetas?.map(tag => (
                      <span key={tag} className="mr-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{tag}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">Nueva Licitación</h2>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium">SKU *</label>
                  <input value={sku} onChange={e => setSku(e.target.value)} className="w-full rounded-lg border p-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium">Cantidad *</label>
                  <input type="number" value={cantidad} onChange={e => setCantidad(e.target.value)} className="w-full rounded-lg border p-2 text-sm" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium">URL Imagen (Opcional)</label>
                <input value={imagenUrl} onChange={e => setImagenUrl(e.target.value)} placeholder="https://..." className="w-full rounded-lg border p-2 text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium">Precio Ref (Opcional)</label>
                  <input type="number" value={precioRef} onChange={e => setPrecioRef(e.target.value)} className="w-full rounded-lg border p-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium">Precio Máx (Opcional)</label>
                  <input type="number" value={precioMax} onChange={e => setPrecioMax(e.target.value)} className="w-full rounded-lg border p-2 text-sm" />
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                <input type="checkbox" id="modoPrueba" checked={modoPrueba} onChange={e => setModoPrueba(e.target.checked)} className="h-4 w-4" />
                <label htmlFor="modoPrueba" className="text-sm font-medium text-amber-800">
                  Modo Prueba (Envía solo al proveedor "TEST")
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setIsModalOpen(false)} className="rounded-lg px-4 py-2 text-sm text-slate-600">Cancelar</button>
              <button onClick={handleGuardarLicitacion} disabled={saving} className="rounded-lg bg-orange-500 px-4 py-2 text-sm text-white">
                {saving ? 'Guardando...' : 'Encolar Envíos'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
