import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase'; // ajustá la ruta si corresponde

type Proveedor = {
  id: string;
  nombre: string;
  telefono: string | null;
  email?: string | null;
  activo?: boolean;
};

type FormState = {
  sku: string;
  cantidad: string;
  imagen_url: string;
  precio_referencia: string;
  precio_maximo: string;
};

const EMPTY_FORM: FormState = {
  sku: '',
  cantidad: '1',
  imagen_url: '',
  precio_referencia: '',
  precio_maximo: '',
};

export default function Proveedores() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void fetchProveedores();
  }, []);

  async function fetchProveedores() {
    setLoading(true);
    const { data, error } = await supabase
      .from('proveedores')
      .select('*')
      .order('nombre', { ascending: true });

    if (error) {
      setMessage({ type: 'error', text: `No se pudieron cargar los proveedores: ${error.message}` });
    } else {
      setProveedores(data ?? []);
    }
    setLoading(false);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetAndClose() {
    if (saving) return;
    setForm(EMPTY_FORM);
    setIsModalOpen(false);
  }

  const imagePreview = useMemo(() => {
    const url = form.imagen_url.trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) return null;
    return url;
  }, [form.imagen_url]);

  async function handleLanzarLicitacion() {
    setMessage(null);

    const sku = form.sku.trim();
    const cantidad = Number(form.cantidad);

    if (!sku) {
      setMessage({ type: 'error', text: 'El SKU es obligatorio.' });
      return;
    }
    if (!cantidad || cantidad <= 0) {
      setMessage({ type: 'error', text: 'La cantidad debe ser mayor a 0.' });
      return;
    }

    const precioRefNum = form.precio_referencia.trim() === '' ? null : Number(form.precio_referencia);
    const precioMaxNum = form.precio_maximo.trim() === '' ? null : Number(form.precio_maximo);

    if (precioRefNum !== null && (Number.isNaN(precioRefNum) || precioRefNum < 0)) {
      setMessage({ type: 'error', text: 'El precio de referencia no es válido.' });
      return;
    }
    if (precioMaxNum !== null && (Number.isNaN(precioMaxNum) || precioMaxNum < 0)) {
      setMessage({ type: 'error', text: 'El precio máximo no es válido.' });
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('licitaciones').insert({
      sku,
      cantidad,
      imagen_url: form.imagen_url.trim() || null,
      precio_referencia: precioRefNum,
      precio_maximo: precioMaxNum,
      estado: 'pending',
    });
    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: `No se pudo crear la licitación: ${error.message}` });
      return;
    }

    setMessage({ type: 'ok', text: 'Licitación creada. El sistema avisará a los proveedores.' });
    setForm(EMPTY_FORM);
    setIsModalOpen(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Proveedores</h1>
            <p className="text-sm text-slate-500">
              Gestioná tus proveedores y lanzá licitaciones masivas para buscar stock.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setIsModalOpen(true);
            }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow hover:bg-slate-800"
          >
            Lanzar Licitación
          </button>
        </div>

        {message && (
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
              message.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Teléfono</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    Cargando proveedores...
                  </td>
                </tr>
              ) : proveedores.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    No hay proveedores cargados.
                  </td>
                </tr>
              ) : (
                proveedores.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{p.nombre}</td>
                    <td className="px-4 py-3 text-slate-600">{p.telefono || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{p.email || '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          p.activo === false
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {p.activo === false ? 'Inactivo' : 'Activo'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Nueva Licitación</h2>
              <button
                type="button"
                onClick={resetAndClose}
                disabled={saving}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    SKU / Producto *
                  </label>
                  <input
                    value={form.sku}
                    onChange={(e) => update('sku', e.target.value)}
                    placeholder="SKU-1234"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Cantidad *</label>
                  <input
                    type="number"
                    min={1}
                    value={form.cantidad}
                    onChange={(e) => update('cantidad', e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  URL de la imagen (opcional)
                </label>
                <input
                  value={form.imagen_url}
                  onChange={(e) => update('imagen_url', e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                />
                {imagePreview && (
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="mt-2 h-24 w-24 rounded-lg border border-slate-200 object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Precio Referencia
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.precio_referencia}
                    onChange={(e) => update('precio_referencia', e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Precio Máximo
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.precio_maximo}
                    onChange={(e) => update('precio_maximo', e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={resetAndClose}
                disabled={saving}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleLanzarLicitacion}
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar y Lanzar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
