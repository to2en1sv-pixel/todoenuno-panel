import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Trash2, MapPin, Phone, Store, ShieldCheck, CheckCircle2 } from 'lucide-react';

type Proveedor = {
  id: string;
  nombre: string;
  telefono: string;
  ubicacion: string;
  categorias: string[];
  ofrece_fulfillment: boolean;
  score: number;
  estado: string;
};

export function ProveedoresPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Formulario
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [ubicacion, setUbicacion] = useState('San Salvador');
  const [categoria, setCategoria] = useState('Hogar');
  const [fulfillment, setFulfillment] = useState(false);

  useEffect(() => {
    loadProveedores();
  }, []);

  async function loadProveedores() {
    const { data } = await supabase.from('proveedores').select('*').order('created_at', { ascending: false });
    if (data) setProveedores(data);
    setLoading(false);
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre || !telefono) return;

    const { error } = await supabase.from('proveedores').insert({
      nombre,
      telefono,
      ubicacion,
      categorias: [categoria],
      ofrece_fulfillment: fulfillment
    });

    if (!error) {
      setShowForm(false);
      setNombre(''); setTelefono(''); setFulfillment(false);
      loadProveedores();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este proveedor?')) return;
    await supabase.from('proveedores').delete().eq('id', id);
    loadProveedores();
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Store size={20} className="text-[var(--ac)]"/> Red de Proveedores</h1>
          <p className="text-xs text-[var(--mu)] mt-1">Gestiona tus almacenes para licitaciones en masa.</p>
        </div>
        <button 
          onClick={() => setShowForm(!showForm)}
          className="w-full sm:w-auto px-5 py-2.5 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-80 transition-colors"
        >
          <Plus size={16} /> {showForm ? 'Cancelar' : 'Nuevo Proveedor'}
        </button>
      </div>

      {/* Formulario */}
      {showForm && (
        <form onSubmit={handleAdd} className="bg-cd bd rounded-xl p-5 shadow-sm border-l-4 border-l-[var(--ac)] flex flex-col gap-4">
          <h3 className="text-sm font-bold">Agregar Proveedor</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="Nombre del Almacén" value={nombre} onChange={e=>setNombre(e.target.value)} className="bg-sf bd rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--ac)]" required />
            <input placeholder="Teléfono / WhatsApp" value={telefono} onChange={e=>setTelefono(e.target.value)} className="bg-sf bd rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--ac)]" required />
            <select value={ubicacion} onChange={e=>setUbicacion(e.target.value)} className="bg-sf bd rounded-lg px-3 py-2 text-sm outline-none">
              <option value="San Salvador">San Salvador</option>
              <option value="Santa Ana">Santa Ana</option>
              <option value="San Miguel">San Miguel</option>
              <option value="La Libertad">La Libertad</option>
              <option value="Otro">Otro</option>
            </select>
            <select value={categoria} onChange={e=>setCategoria(e.target.value)} className="bg-sf bd rounded-lg px-3 py-2 text-sm outline-none">
              <option value="Hogar">Hogar</option>
              <option value="Belleza">Belleza</option>
              <option value="Tecnología">Tecnología</option>
              <option value="Textiles">Textiles</option>
              <option value="Varios">Varios</option>
            </select>
          </div>
          
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input type="checkbox" checked={fulfillment} onChange={e=>setFulfillment(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-[var(--ac)] focus:ring-[var(--ac)]" />
            ¿Ofrece Dropshipping (Fulfillment directo)?
          </label>

          <button type="submit" className="bg-[var(--ac)] text-white py-2 rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity">Guardar Proveedor</button>
        </form>
      )}

      {/* Lista de Proveedores */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
        {loading && <div className="col-span-full text-center p-8 tx-mu">Cargando proveedores...</div>}
        {!loading && proveedores.length === 0 && <div className="col-span-full text-center p-8 tx-mu">No hay proveedores registrados. ¡Agrega el primero!</div>}
        
        {proveedores.map(p => (
          <div key={p.id} className="bg-cd border border-[var(--bd)] rounded-xl p-4 flex flex-col gap-3 group hover:border-[var(--ac)] transition-colors">
            <div className="flex justify-between items-start">
              <div className="font-bold text-sm">{p.nombre}</div>
              <button onClick={() => handleDelete(p.id)} className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                <Trash2 size={16} />
              </button>
            </div>
            
            <div className="flex flex-col gap-1 text-xs tx-mu">
              <div className="flex items-center gap-2"><Phone size={12}/> {p.telefono}</div>
              <div className="flex items-center gap-2"><MapPin size={12}/> {p.ubicacion}</div>
            </div>

            <div className="flex gap-2 mt-2">
              {p.ofrece_fulfillment && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-100 text-green-700 flex items-center gap-1">
                  <ShieldCheck size={10} /> Dropshipping
                </span>
              )}
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sf border border-[var(--bd)] text-[var(--mu)] uppercase">
                {p.categorias?.[0] || 'Varios'}
              </span>
            </div>
            
            <div className="mt-2 pt-3 border-t border-[var(--bd)] flex justify-between items-center">
              <span className="text-[10px] font-semibold text-[var(--mu)] uppercase">Score de Confianza</span>
              <div className="flex items-center gap-1 text-green-600 font-bold text-sm">
                {p.score} <CheckCircle2 size={14} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
