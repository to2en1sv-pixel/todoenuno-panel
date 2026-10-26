import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Trash2, Calendar as CalendarIcon, DollarSign, AlertCircle, CheckCircle2 } from 'lucide-react';

type Pago = {
  id: string;
  nombre: string;
  monto: number;
  moneda: string;
  fecha_vencimiento: string;
  frecuencia: string;
  categoria: string;
};

export function PagosPage() {
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Formulario
  const [nombre, setNombre] = useState('');
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState('');
  const [categoria, setCategoria] = useState('software');
  const [frecuencia, setFrecuencia] = useState('mensual');

  useEffect(() => {
    loadPagos();
  }, []);

  async function loadPagos() {
    const { data } = await supabase.from('panel_pagos').select('*').order('fecha_vencimiento', { ascending: true });
    if (data) setPagos(data);
    setLoading(false);
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre || !monto || !fecha) return;

    const { error } = await supabase.from('panel_pagos').insert({
      nombre,
      monto: parseFloat(monto),
      fecha_vencimiento: fecha,
      categoria,
      frecuencia
    });

    if (!error) {
      setShowForm(false);
      setNombre(''); setMonto(''); setFecha('');
      loadPagos();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este pago definitivamente?')) return;
    await supabase.from('panel_pagos').delete().eq('id', id);
    loadPagos();
  };

  // NUEVA FUNCIÓN: Avanzar la fecha al siguiente periodo
  const handlePagar = async (pago: Pago) => {
    // Usamos T12:00:00 para evitar problemas de zona horaria al convertir a string
    let nuevaFecha = new Date(pago.fecha_vencimiento + 'T12:00:00');

    if (pago.frecuencia === 'mensual') {
      nuevaFecha.setMonth(nuevaFecha.getMonth() + 1);
    } else if (pago.frecuencia === 'anual') {
      nuevaFecha.setFullYear(nuevaFecha.getFullYear() + 1);
    }

    const nuevaFechaStr = nuevaFecha.toISOString().split('T')[0];

    const { error } = await supabase
      .from('panel_pagos')
      .update({ fecha_vencimiento: nuevaFechaStr })
      .eq('id', pago.id);

    if (!error) {
      alert(`✅ ¡Pago de ${pago.nombre} registrado!\nPróximo vencimiento: ${nuevaFecha.toLocaleDateString('es-SV')}`);
      loadPagos();
    } else {
      alert('Error al actualizar el pago.');
    }
  };

  // Cálculos
  const totalMes = pagos.filter(p => p.frecuencia === 'mensual').reduce((acc, p) => acc + p.monto, 0);
  
  const hoy = new Date();
  hoy.setHours(0,0,0,0);
  
  const pagosProximos = pagos.filter(p => {
    const f = new Date(p.fecha_vencimiento + 'T00:00:00');
    const diff = f.getTime() - hoy.getTime();
    const dias = diff / (1000 * 60 * 60 * 24);
    return dias >= 0 && dias <= 5; 
  });

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4 pb-10">
      
      {/* Tarjetas Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-cd bd rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] tx-mu uppercase tracking-wider">Gasto Mensual</div>
            <div className="text-2xl font-bold">${totalMes.toFixed(2)}</div>
          </div>
          <DollarSign className="text-green-500" size={24} />
        </div>
        <div className="bg-cd bd rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] tx-mu uppercase tracking-wider">Total Suscripciones</div>
            <div className="text-2xl font-bold">{pagos.length}</div>
          </div>
          <CalendarIcon className="text-blue-500" size={24} />
        </div>
        {pagosProximos.length > 0 && (
          <div className="bg-kb rounded-xl p-4 flex items-center justify-between border border-orange-200">
            <div>
              <div className="text-[11px] text-orange-600 uppercase tracking-wider font-bold">¡Próximos Vencimientos!</div>
              <div className="text-lg font-bold text-orange-700">{pagosProximos.length} por pagar</div>
            </div>
            <AlertCircle className="text-orange-500" size={24} />
          </div>
        )}
      </div>

      {/* Botón Nuevo Pago */}
      <div className="flex justify-between items-center mt-4">
        <h2 className="text-lg font-bold">Calendario de Pagos</h2>
        <button onClick={() => setShowForm(!showForm)} className="bg-[var(--tx)] text-[var(--cd)] px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Plus size={16} /> {showForm ? 'Cancelar' : 'Nuevo Pago'}
        </button>
      </div>

      {/* Formulario (Oculto por defecto) */}
      {showForm && (
        <form onSubmit={handleAdd} className="bg-cd bd rounded-xl p-4 flex flex-col gap-3 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="Nombre (Ej. DigitalOcean)" value={nombre} onChange={e=>setNombre(e.target.value)} className="bg-sf bd rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--ac)]" required />
            <input placeholder="Monto ($)" type="number" step="0.01" value={monto} onChange={e=>setMonto(e.target.value)} className="bg-sf bd rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--ac)]" required />
            <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} className="bg-sf bd rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--ac)]" required />
            <select value={frecuencia} onChange={e=>setFrecuencia(e.target.value)} className="bg-sf bd rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--ac)]">
              <option value="mensual">Mensual</option>
              <option value="anual">Anual</option>
              <option value="unico">Pago Único</option>
            </select>
            <select value={categoria} onChange={e=>setCategoria(e.target.value)} className="bg-sf bd rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--ac)] sm:col-span-2">
              <option value="software">Software</option>
              <option value="infraestructura">Infraestructura</option>
              <option value="marketing">Marketing</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <button type="submit" className="bg-[var(--ac)] text-white py-2 rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity">Guardar Pago</button>
        </form>
      )}

      {/* Lista de Pagos */}
      <div className="bg-cd bd rounded-xl overflow-hidden mt-2 shadow-sm">
        {loading && <div className="p-4 text-center text-sm tx-mu">Cargando pagos...</div>}
        {!loading && pagos.length === 0 && <div className="p-8 text-center text-sm tx-mu">No tienes pagos registrados. ¡Agrega el primero!</div>}
        
        {pagos.map(pago => {
          const f = new Date(pago.fecha_vencimiento + 'T00:00:00');
          const diff = f.getTime() - hoy.getTime();
          const dias = Math.ceil(diff / (1000 * 60 * 60 * 24));
          
          let colorFecha = 'text-green-600';
          let bgFecha = 'bg-green-100';
          if (dias < 0) { colorFecha = 'text-red-600'; bgFecha = 'bg-red-100'; }
          else if (dias <= 5) { colorFecha = 'text-orange-600'; bgFecha = 'bg-orange-100'; }

          return (
            <div key={pago.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border-b last:border-0 gap-3" style={{ borderColor: 'var(--bd)' }}>
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-lg ${bgFecha} ${colorFecha}`}>
                  <CalendarIcon size={20} />
                </div>
                <div>
                  <div className="font-semibold text-sm">{pago.nombre}</div>
                  <div className="text-[11px] tx-mu flex items-center gap-2 mt-1">
                    <span className="uppercase text-[9px] bg-sf px-1.5 py-0.5 rounded border border-[var(--bd)]">{pago.categoria}</span>
                    <span className="capitalize">{pago.frecuencia}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                <div className="text-left sm:text-right">
                  <div className="font-bold text-sm">${pago.monto.toFixed(2)} {pago.moneda}</div>
                  <div className={`text-[11px] font-semibold ${colorFecha}`}>
                    {dias === 0 ? 'Vence hoy' : dias < 0 ? `Vencido hace ${Math.abs(dias)}d` : `En ${dias} días`}
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {/* BOTÓN DE PAGADO */}
                  <button 
                    onClick={() => handlePagar(pago)} 
                    className="bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 border border-green-200"
                    title="Marcar como pagado y avanzar fecha"
                  >
                    <CheckCircle2 size={14} /> Pagar
                  </button>

                  {/* BOTÓN DE BORRAR */}
                  <button onClick={() => handleDelete(pago.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
