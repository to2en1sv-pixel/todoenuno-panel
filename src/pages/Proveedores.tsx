import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { 
  Building2, 
  Send, 
  Plus, 
  Search, 
  Sparkles, 
  TrendingDown, 
  Award, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  ExternalLink, 
  MessageSquare, 
  Tag, 
  Phone, 
  DollarSign, 
  Boxes, 
  ChevronRight, 
  Check, 
  Eye, 
  ArrowDownLeft, 
  Layers,
  BarChart3,
  RefreshCw,
  Edit,
  Trash2
} from 'lucide-react';
import { emitOsEvent } from '@/lib/osEvents';

type Proveedor = {
  id: string;
  nombre: string;
  telefono: string | null;
  etiquetas: string[];
};

type Licitacion = {
  id: string;
  sku: string;
  cantidad: number;
  imagen_url: string | null;
  precio_referencia: number | null;
  precio_maximo: number | null;
  modo_prueba: boolean;
  estado: string; // 'pending', 'active', 'completed', 'cancelled'
  ganador_proveedor_id?: string | null;
  precio_adjudicado?: number | null;
  ahorro_total?: number | null;
  created_at: string;
};

type OfertaProveedor = {
  id: string;
  licitacion_id: string;
  proveedor_id: string;
  precio_ofertado?: number | null;
  cantidad_disponible?: number | null;
  tiempo_entrega?: string | null;
  estado: string; // 'enviado', 'respondido', 'ganador', 'rechazado'
  notas?: string | null;
  created_at: string;
};

export function ProveedoresPage() {
  const [tab, setTab] = useState<'proveedores' | 'licitaciones' | 'scorecard'>('proveedores');
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [licitaciones, setLicitaciones] = useState<Licitacion[]>([]);
  const [ofertas, setOfertas] = useState<OfertaProveedor[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [tagFiltro, setTagFiltro] = useState<string>('todos');
  const [loading, setLoading] = useState(true);

  // Modales
  const [isModalOpen, setIsModalOpen] = useState(false); // Modal Licitación
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false); // Modal Proveedor
  const [licitacionDetalle, setLicitacionDetalle] = useState<Licitacion | null>(null);
  const [modalNuevaOferta, setModalNuevaOferta] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  // Form Licitación
  const [sku, setSku] = useState('');
  const [cantidad, setCantidad] = useState('50');
  const [imagenUrl, setImagenUrl] = useState('');
  const [precioRef, setPrecioRef] = useState('3.00');
  const [precioMax, setPrecioMax] = useState('4.50');
  const [modoPrueba, setModoPrueba] = useState(false);

  // Form Proveedor (Crear / Editar)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [provNombre, setProvNombre] = useState('');
  const [provTelefono, setProvTelefono] = useState('');
  const [provEtiquetas, setProvEtiquetas] = useState('');

  // Form Oferta Manual (para registrar pujas que llegan por teléfono/chat)
  const [ofertaProveedorId, setOfertaProveedorId] = useState('');
  const [ofertaPrecio, setOfertaPrecio] = useState('');
  const [ofertaCantidad, setOfertaCantidad] = useState('');
  const [ofertaTiempo, setOfertaTiempo] = useState('Entrega hoy mismo');
  const [ofertaNotas, setOfertaNotas] = useState('');

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const [resProv, resLic, resOf] = await Promise.all([
        supabase.from('proveedores').select('*').order('nombre'),
        supabase.from('licitaciones').select('*').order('created_at', { ascending: false }),
        supabase.from('licitacion_proveedores').select('*')
      ]);

      if (resProv.data) setProveedores(resProv.data);
      if (resLic.data) setLicitaciones(resLic.data);
      if (resOf.data) setOfertas(resOf.data);
    } catch (err) {
      console.error('Error cargando proveedores/licitaciones:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  // Extraer todas las etiquetas únicas para segmentación rápida
  const todasLasEtiquetas = useMemo(() => {
    const set = new Set<string>();
    proveedores.forEach(p => {
      (p.etiquetas || []).forEach(t => set.add(t.trim().toLowerCase()));
    });
    return Array.from(set);
  }, [proveedores]);

  // Filtrado de proveedores
  const filteredProveedores = useMemo(() => {
    return proveedores.filter(p => {
      const matchText = p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.telefono && p.telefono.includes(searchTerm));
      
      if (!matchText) return false;
      if (tagFiltro === 'todos') return true;

      return (p.etiquetas || []).some(t => t.trim().toLowerCase() === tagFiltro);
    });
  }, [proveedores, searchTerm, tagFiltro]);

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

  const seleccionarPorEtiqueta = (tag: string) => {
    const coincidencias = proveedores.filter(p => 
      (p.etiquetas || []).some(t => t.trim().toLowerCase() === tag.toLowerCase())
    );
    setSelectedIds(new Set(coincidencias.map(p => p.id)));
  };

  // --- LÓGICA DE PROVEEDORES ---
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
    const etiquetasArray = provEtiquetas.split(',').map(t => t.trim()).filter(Boolean);

    const payload = {
      nombre: provNombre.trim(),
      telefono: provTelefono.trim(),
      etiquetas: etiquetasArray
    };

    let error;
    if (editingProviderId) {
      const res = await supabase.from('proveedores').update(payload).eq('id', editingProviderId);
      error = res.error;
    } else {
      const res = await supabase.from('proveedores').insert(payload);
      error = res.error;
    }

    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: 'Error al guardar: ' + error.message });
    } else {
      if (!editingProviderId) {
        try {
          await emitOsEvent({
            type: 'supplier.created',
            source_table: 'proveedores',
            source_id: provNombre.trim(),
            payload: {
              nombre: provNombre.trim(),
              telefono: provTelefono.trim(),
              etiquetas: etiquetasArray
            }
          });
        } catch {}
      }

      setMessage({ type: 'ok', text: `Proveedor ${editingProviderId ? 'actualizado' : 'creado'} correctamente.` });
      setIsProviderModalOpen(false);
      cargarDatos();
    }
  }

  async function handleDeleteProvider(id: string) {
    if (!window.confirm('¿Estás seguro de eliminar este proveedor?')) return;
    
    const { error } = await supabase.from('proveedores').delete().eq('id', id);
    if (error) {
      setMessage({ type: 'error', text: 'Error al eliminar: ' + error.message });
    } else {
      setMessage({ type: 'ok', text: 'Proveedor eliminado.' });
      cargarDatos();
    }
  }

  // --- LÓGICA DE LICITACIÓN ---
  async function handleGuardarLicitacion() {
    if (selectedIds.size === 0 && !modoPrueba) {
      return setMessage({ type: 'error', text: 'Seleccioná al menos un proveedor o activá Modo Prueba.' });
    }
    if (!sku.trim()) {
      return setMessage({ type: 'error', text: 'El SKU es requerido.' });
    }

    setSaving(true);
    setMessage(null);

    const { data: licitacion, error: errLicitacion } = await supabase
      .from('licitaciones')
      .insert({
        sku: sku.trim().toUpperCase(),
        cantidad: Number(cantidad),
        imagen_url: imagenUrl.trim() || null,
        precio_referencia: precioRef ? Number(precioRef) : null,
        precio_maximo: precioMax ? Number(precioMax) : null,
        modo_prueba: modoPrueba,
        estado: 'active'
      }).select().single();

    if (errLicitacion || !licitacion) {
      setSaving(false);
      return setMessage({ type: 'error', text: errLicitacion?.message || 'Error al crear la licitación' });
    }

    let queueData = [];
    
    if (modoPrueba) {
      const { data: testProvider } = await supabase.from('proveedores').select('id').ilike('nombre', '%TEST%').limit(1).single();
      if (testProvider) queueData.push({ licitacion_id: licitacion.id, proveedor_id: testProvider.id, estado: 'enviado' });
      else {
        const fallback = proveedores[0];
        if (fallback) queueData.push({ licitacion_id: licitacion.id, proveedor_id: fallback.id, estado: 'enviado' });
      }
    } else {
      queueData = Array.from(selectedIds).map(id => ({
        licitacion_id: licitacion.id,
        proveedor_id: id,
        estado: 'enviado'
      }));
    }

    if (queueData.length > 0) {
      await supabase.from('licitacion_proveedores').insert(queueData);
    }

    // Emitir evento al Event Store
    try {
      await emitOsEvent({
        type: 'purchase.requested',
        source_table: 'licitaciones',
        source_id: licitacion.id,
        payload: {
          licitacion_id: licitacion.id,
          sku: licitacion.sku,
          target_qty: licitacion.cantidad,
          target_unit_price: licitacion.precio_referencia,
          max_price: licitacion.precio_maximo,
          proveedores_count: queueData.length
        }
      });
    } catch {}

    setSaving(false);
    setIsModalOpen(false);
    setSelectedIds(new Set());
    setMessage({ type: 'ok', text: `¡Licitación para ${sku} encolada! n8n y Evolution API enviarán los mensajes por WhatsApp.` });
    
    setSku('');
    setCantidad('50');
    setImagenUrl('');
    setPrecioRef('3.00');
    setPrecioMax('4.50');
    setModoPrueba(false);

    await cargarDatos();
  }

  // --- ADJUDICAR OFERTA GANADORA ---
  const handleAdjudicarOferta = async (lic: Licitacion, of: OfertaProveedor) => {
    const prov = proveedores.find(p => p.id === of.proveedor_id);
    const precio = Number(of.precio_ofertado || 0);
    const max = Number(lic.precio_maximo || precio);
    const ahorro = Math.max((max - precio) * (lic.cantidad || 1), 0);

    const conf = window.confirm(
      `¿Deseas adjudicar la compra a "${prov?.nombre || 'Proveedor'}" a un precio de $${precio.toFixed(2)} por unidad?\n\nAhorro calculado: $${ahorro.toFixed(2)} USD`
    );
    if (!conf) return;

    try {
      // 1. Actualizar licitación
      await supabase
        .from('licitaciones')
        .update({
          estado: 'completed',
          ganador_proveedor_id: of.proveedor_id,
          precio_adjudicado: precio,
          ahorro_total: ahorro,
          adjudicado_at: new Date().toISOString()
        })
        .eq('id', lic.id);

      // 2. Marcar oferta como ganadora
      await supabase
        .from('licitacion_proveedores')
        .update({ estado: 'ganador' })
        .eq('id', of.id);

      // 3. Emitir evento
      await emitOsEvent({
        type: 'supplier.selected',
        source_table: 'licitacion_proveedores',
        source_id: of.id,
        payload: {
          licitacion_id: lic.id,
          proveedor_id: of.proveedor_id,
          proveedor_nombre: prov?.nombre,
          precio_unitario: precio,
          cantidad: lic.cantidad,
          ahorro_total: ahorro
        }
      });

      setMessage({ type: 'ok', text: `¡Compra adjudicada a ${prov?.nombre}! Ya puedes registrar la entrada en inventario.` });
      await cargarDatos();
      setLicitacionDetalle(null);
    } catch (err) {
      console.error('Error al adjudicar:', err);
    }
  };

  // Guardar Puja Manual
  const handleGuardarPujaManual = async () => {
    if (!licitacionDetalle || !ofertaProveedorId || !ofertaPrecio) return;

    try {
      await supabase
        .from('licitacion_proveedores')
        .upsert({
          licitacion_id: licitacionDetalle.id,
          proveedor_id: ofertaProveedorId,
          precio_ofertado: parseFloat(ofertaPrecio),
          cantidad_disponible: parseInt(ofertaCantidad || String(licitacionDetalle.cantidad)),
          tiempo_entrega: ofertaTiempo,
          notas: ofertaNotas,
          estado: 'respondido',
          respondido_at: new Date().toISOString()
        });

      // Emitir evento al OS Event Store
      try {
        await emitOsEvent({
          type: 'supplier.bid.received',
          source_table: 'licitacion_proveedores',
          source_id: `${licitacionDetalle.id}:${ofertaProveedorId}`,
          payload: {
            licitacion_id: licitacionDetalle.id,
            sku: licitacionDetalle.sku,
            proveedor_id: ofertaProveedorId,
            precio_ofertado: parseFloat(ofertaPrecio),
            cantidad: parseInt(ofertaCantidad || String(licitacionDetalle.cantidad)),
            tiempo_entrega: ofertaTiempo
          }
        });
      } catch {}

      setModalNuevaOferta(false);
      setOfertaProveedorId('');
      setOfertaPrecio('');
      setOfertaCantidad('');
      setOfertaNotas('');
      await cargarDatos();
    } catch (err) {
      console.error('Error guardando oferta:', err);
    }
  };

  // KPIs de Licitaciones e Inteligencia
  const kpisLicitaciones = useMemo(() => {
    let activas = 0;
    let completadas = 0;
    let ahorroTotal = 0;

    licitaciones.forEach(l => {
      if (l.estado === 'active' || l.estado === 'pending') activas++;
      if (l.estado === 'completed') {
        completadas++;
        ahorroTotal += Number(l.ahorro_total || 0);
      }
    });

    return { activas, completadas, ahorroTotal };
  }, [licitaciones]);

  // Scorecard de Proveedores
  const scorecardProveedores = useMemo(() => {
    const mapa = new Map<string, {
      proveedor: Proveedor;
      totalInvitaciones: number;
      totalRespuestas: number;
      adjudicacionesGanadas: number;
      mejorPrecioHistorico: number;
    }>();

    proveedores.forEach(p => {
      mapa.set(p.id, {
        proveedor: p,
        totalInvitaciones: 0,
        totalRespuestas: 0,
        adjudicacionesGanadas: 0,
        mejorPrecioHistorico: 0
      });
    });

    ofertas.forEach(o => {
      const item = mapa.get(o.proveedor_id);
      if (item) {
        item.totalInvitaciones++;
        if (o.precio_ofertado && o.precio_ofertado > 0) {
          item.totalRespuestas++;
          if (item.mejorPrecioHistorico === 0 || o.precio_ofertado < item.mejorPrecioHistorico) {
            item.mejorPrecioHistorico = o.precio_ofertado;
          }
        }
        if (o.estado === 'ganador') {
          item.adjudicacionesGanadas++;
        }
      }
    });

    return Array.from(mapa.values()).sort((a, b) => b.adjudicacionesGanadas - a.adjudicacionesGanadas);
  }, [proveedores, ofertas]);

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-16 min-h-screen">
      {/* Encabezado */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
            Proveedores
          </h1>
          <p className="text-xs text-[var(--mu)] mt-1">
            Red de almacenes por WhatsApp, subasta inversa y comparador de cotizaciones
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleOpenNewProvider}
            className="px-3.5 py-2 border border-[var(--bd)] bg-cd hover:bg-sf rounded-lg text-xs font-semibold text-[var(--tx)] flex items-center gap-1.5 transition-colors"
          >
            <Plus size={13} /> Nuevo proveedor
          </button>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-opacity"
          >
            <Send size={13} /> Lanzar licitación ({selectedIds.size})
          </button>
        </div>
      </header>

      {message && (
        <div className={`px-4 py-2.5 rounded-lg text-xs flex items-center justify-between border ${
          message.type === 'ok'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
        }`}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {/* Franja unificada de 4 KPIs */}
      <section className="bg-cd border border-[var(--bd)] rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--bd)]">
        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Almacenes registrados</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)] mt-1.5">
            {proveedores.length}
          </div>
          <div className="text-xs text-[var(--mu)] mt-1">Conexión WhatsApp directa</div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Licitaciones activas</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1.5">
            {kpisLicitaciones.activas}
          </div>
          <div className="text-xs text-[var(--mu)] mt-1">Esperando cotizaciones</div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Compras adjudicadas</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)] mt-1.5">
            {kpisLicitaciones.completadas}
          </div>
          <div className="text-xs text-[var(--mu)] mt-1">Subastas cerradas</div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Ahorro en subastas</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1.5">
            ${kpisLicitaciones.ahorroTotal.toFixed(2)}
          </div>
          <div className="text-xs text-[var(--mu)] mt-1">Presupuesto máx. vs real</div>
        </div>
      </section>

      {/* Navegación por pestañas */}
      <nav className="flex items-center gap-6 border-b border-[var(--bd)] overflow-x-auto">
        {[
          { id: 'proveedores', label: `Red de almacenes (${proveedores.length})` },
          { id: 'licitaciones', label: `Licitaciones (${licitaciones.length})` },
          { id: 'scorecard', label: `Scorecard (${scorecardProveedores.length})` },
        ].map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as any)}
              className={`pb-3 text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                active
                  ? 'border-[var(--tx)] text-[var(--tx)]'
                  : 'border-transparent text-[var(--mu)] hover:text-[var(--tx)]'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* PESTAÑA 1: RED DE PROVEEDORES */}
      {tab === 'proveedores' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
            <div className="relative flex-1 sm:max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mu)]" />
              <input
                type="text"
                placeholder="Buscar por almacén o teléfono..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-cd border border-[var(--bd)] rounded-lg text-xs text-[var(--tx)] outline-none focus:border-[var(--tx)]"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto text-xs py-0.5">
              <span className="text-xs text-[var(--mu)] shrink-0 mr-1">Nicho:</span>
              <button
                type="button"
                onClick={() => setTagFiltro('todos')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  tagFiltro === 'todos'
                    ? 'bg-[var(--tx)] text-[var(--cd)] font-semibold'
                    : 'bg-cd border border-[var(--bd)] text-[var(--mu)] hover:text-[var(--tx)]'
                }`}
              >
                Todos
              </button>
              {todasLasEtiquetas.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTagFiltro(t);
                    seleccionarPorEtiqueta(t);
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    tagFiltro === t
                      ? 'bg-[var(--tx)] text-[var(--cd)] font-semibold'
                      : 'bg-cd border border-[var(--bd)] text-[var(--mu)] hover:text-[var(--tx)]'
                  }`}
                  title={`Filtrar y preseleccionar #${t}`}
                >
                  #{t}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-sf/50 border-b border-[var(--bd)] text-[var(--mu)]">
                  <tr>
                    <th className="px-4 py-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.size > 0 && selectedIds.size === filteredProveedores.length}
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Almacén / Proveedor</th>
                    <th className="px-4 py-3 font-medium">Teléfono WhatsApp</th>
                    <th className="px-4 py-3 font-medium">Especialidad</th>
                    <th className="px-4 py-3 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--bd)]">
                  {loading && filteredProveedores.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-[var(--mu)]">
                        Cargando almacenes...
                      </td>
                    </tr>
                  ) : filteredProveedores.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-[var(--mu)]">
                        No se encontraron almacenes con estos filtros.
                      </td>
                    </tr>
                  ) : (
                    filteredProveedores.map(p => {
                      const isSelected = selectedIds.has(p.id);
                      return (
                        <tr key={p.id} className={`hover:bg-sf/40 transition-colors ${isSelected ? 'bg-sf/60' : ''}`}>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(p.id)}
                              className="rounded"
                            />
                          </td>
                          <td className="px-4 py-3 font-semibold text-[var(--tx)]">
                            {p.nombre}
                          </td>
                          <td className="px-4 py-3 font-mono tabular-nums text-[var(--mu)]">
                            {p.telefono || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5 text-[11px] text-[var(--mu)]">
                              {(p.etiquetas || []).length > 0
                                ? (p.etiquetas || []).map(t => (
                                    <span key={t} className="px-2 py-0.5 rounded bg-sf border border-[var(--bd)] font-medium">
                                      #{t}
                                    </span>
                                  ))
                                : '—'}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleOpenEditProvider(p)}
                              className="p-1.5 rounded-lg text-[var(--mu)] hover:text-[var(--tx)] transition-colors mr-1"
                              title="Editar"
                            >
                              <Edit size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteProvider(p.id)}
                              className="p-1.5 rounded-lg text-[var(--mu)] hover:text-rose-500 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 2: SUBASTAS EN VIVO */}
      {tab === 'licitaciones' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {licitaciones.length === 0 ? (
            <div className="col-span-full py-14 text-center text-xs text-[var(--mu)] bg-cd rounded-xl border border-[var(--bd)]">
              No hay licitaciones registradas aún. Presiona "Lanzar licitación" para empezar.
            </div>
          ) : (
            licitaciones.map(lic => {
              const ofertasDeEsta = ofertas.filter(o => o.licitacion_id === lic.id);
              const ofertasRespondidas = ofertasDeEsta.filter(o => o.precio_ofertado && o.precio_ofertado > 0);
              const mejorOferta = ofertasRespondidas.sort((a, b) => Number(a.precio_ofertado) - Number(b.precio_ofertado))[0];
              const provGanador = lic.ganador_proveedor_id ? proveedores.find(p => p.id === lic.ganador_proveedor_id) : null;
              const esCompletada = lic.estado === 'completed';

              return (
                <div
                  key={lic.id}
                  onClick={() => setLicitacionDetalle(lic)}
                  className="bg-cd border border-[var(--bd)] rounded-xl p-5 flex flex-col justify-between hover:border-[var(--tx)] transition-colors cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono tabular-nums text-[var(--mu)]">
                        {new Date(lic.created_at).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}
                      </span>
                      <span
                        className={`text-[11px] font-semibold ${
                          esCompletada
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {esCompletada ? 'Adjudicada' : 'Subasta activa'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 mt-3">
                      <div className="w-11 h-11 rounded-lg bg-sf border border-[var(--bd)] overflow-hidden shrink-0 flex items-center justify-center">
                        {lic.imagen_url ? (
                          <img src={lic.imagen_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Boxes size={16} className="text-[var(--mu)]" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <h3 className="font-mono font-bold text-sm text-[var(--tx)] truncate">{lic.sku}</h3>
                        <span className="text-xs text-[var(--mu)] block tabular-nums">
                          {lic.cantidad} unidades
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-[var(--bd)] grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-[11px] text-[var(--mu)] block">P. Objetivo</span>
                        <span className="font-mono tabular-nums font-semibold text-[var(--tx)]">
                          ${lic.precio_referencia ? Number(lic.precio_referencia).toFixed(2) : '—'}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] text-[var(--mu)] block">P. Máximo</span>
                        <span className="font-mono tabular-nums font-semibold text-[var(--tx)]">
                          ${lic.precio_maximo ? Number(lic.precio_maximo).toFixed(2) : '—'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-[var(--bd)] space-y-1 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--mu)]">Contactados</span>
                        <span className="font-mono tabular-nums font-medium text-[var(--tx)]">{ofertasDeEsta.length}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--mu)]">Cotizaciones</span>
                        <span className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                          {ofertasRespondidas.length}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[var(--bd)] flex items-center justify-between text-xs">
                    {esCompletada && provGanador ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                        {provGanador.nombre} · ${Number(lic.precio_adjudicado || 0).toFixed(2)}
                      </span>
                    ) : mejorOferta ? (
                      <span className="text-[var(--tx)] font-semibold font-mono tabular-nums">
                        Mejor: ${Number(mejorOferta.precio_ofertado).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-[var(--mu)]">Sin cotizaciones</span>
                    )}
                    <span className="font-medium text-[var(--mu)] group-hover:text-[var(--tx)] shrink-0">
                      Comparar →
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* PESTAÑA 3: SCORECARD */}
      {tab === 'scorecard' && (
        <div className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--bd)]">
            <h3 className="font-semibold text-sm text-[var(--tx)]">Confiabilidad de almacenes</h3>
            <p className="text-xs text-[var(--mu)] mt-0.5">
              Tasa de respuesta a licitaciones y mejores precios históricos adjudicados.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-sf/50 border-b border-[var(--bd)] text-[var(--mu)]">
                <tr>
                  <th className="px-5 py-3 font-medium">Almacén</th>
                  <th className="px-4 py-3 text-center font-medium">Invitaciones</th>
                  <th className="px-4 py-3 text-center font-medium">Respuestas</th>
                  <th className="px-4 py-3 text-center font-medium">Tasa</th>
                  <th className="px-4 py-3 text-center font-medium">Ganadas</th>
                  <th className="px-5 py-3 text-right font-medium">Mejor precio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {scorecardProveedores.map((sc, idx) => {
                  const tasa = sc.totalInvitaciones > 0 ? (sc.totalRespuestas / sc.totalInvitaciones) * 100 : 0;
                  const esTop = sc.adjudicacionesGanadas > 0 && idx === 0;

                  return (
                    <tr key={sc.proveedor.id} className="hover:bg-sf/40 transition-colors">
                      <td className="px-5 py-3">
                        <div className="font-semibold text-[var(--tx)] flex items-center gap-2">
                          {sc.proveedor.nombre}
                          {esTop && (
                            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                              · Top
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-[var(--mu)] font-mono">{sc.proveedor.telefono || '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-center font-mono tabular-nums text-[var(--tx)]">
                        {sc.totalInvitaciones}
                      </td>
                      <td className="px-4 py-3 text-center font-mono tabular-nums text-[var(--tx)]">
                        {sc.totalRespuestas}
                      </td>
                      <td className="px-4 py-3 text-center font-mono tabular-nums font-semibold">
                        <span
                          className={
                            tasa >= 75
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : tasa >= 40
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-[var(--mu)]'
                          }
                        >
                          {tasa.toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                        {sc.adjudicacionesGanadas}
                      </td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums font-semibold text-[var(--tx)]">
                        {sc.mejorPrecioHistorico > 0 ? `$${sc.mejorPrecioHistorico.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: COMPARADOR DE OFERTAS */}
      {licitacionDetalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setLicitacionDetalle(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-sf border border-[var(--bd)] overflow-hidden shrink-0 flex items-center justify-center">
                  {licitacionDetalle.imagen_url ? (
                    <img src={licitacionDetalle.imagen_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Boxes size={16} className="text-[var(--mu)]" />
                  )}
                </div>
                <div>
                  <span className="text-[11px] font-mono text-[var(--mu)]">#{licitacionDetalle.sku}</span>
                  <h3 className="font-semibold text-sm text-[var(--tx)]">
                    Requerimiento: {licitacionDetalle.cantidad} unidades
                  </h3>
                </div>
              </div>

              <button type="button" onClick={() => setLicitacionDetalle(null)} className="p-1.5 text-[var(--mu)] hover:text-[var(--tx)] rounded-lg">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              <div className="grid grid-cols-3 divide-x divide-[var(--bd)] bg-sf rounded-lg border border-[var(--bd)] text-center text-xs">
                <div className="p-3">
                  <span className="text-[11px] text-[var(--mu)] block">P. Objetivo</span>
                  <span className="font-mono tabular-nums font-bold text-sm text-[var(--tx)]">
                    ${licitacionDetalle.precio_referencia ? Number(licitacionDetalle.precio_referencia).toFixed(2) : '—'}
                  </span>
                </div>
                <div className="p-3">
                  <span className="text-[11px] text-[var(--mu)] block">P. Máximo</span>
                  <span className="font-mono tabular-nums font-bold text-sm text-rose-600 dark:text-rose-400">
                    ${licitacionDetalle.precio_maximo ? Number(licitacionDetalle.precio_maximo).toFixed(2) : '—'}
                  </span>
                </div>
                <div className="p-3">
                  <span className="text-[11px] text-[var(--mu)] block">Presupuesto máx.</span>
                  <span className="font-mono tabular-nums font-bold text-sm text-[var(--tx)]">
                    ${((licitacionDetalle.cantidad || 1) * Number(licitacionDetalle.precio_maximo || 0)).toFixed(2)}
                  </span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-[var(--tx)]">
                    Pujas recibidas (menor a mayor)
                  </h4>

                  <button
                    type="button"
                    onClick={() => setModalNuevaOferta(true)}
                    className="px-3 py-1.5 bg-cd border border-[var(--bd)] hover:bg-sf rounded-lg text-xs font-semibold text-[var(--tx)]"
                  >
                    + Registrar puja manual
                  </button>
                </div>

                <div className="divide-y divide-[var(--bd)] border border-[var(--bd)] rounded-xl overflow-hidden">
                  {ofertas
                    .filter(o => o.licitacion_id === licitacionDetalle.id)
                    .sort((a, b) => Number(a.precio_ofertado || 9999) - Number(b.precio_ofertado || 9999))
                    .map((of, index) => {
                      const prov = proveedores.find(p => p.id === of.proveedor_id);
                      const tienePrecio = of.precio_ofertado && of.precio_ofertado > 0;
                      const esGanador = of.estado === 'ganador' || licitacionDetalle.ganador_proveedor_id === of.proveedor_id;
                      const ahorroUni = tienePrecio && licitacionDetalle.precio_maximo ? Number(licitacionDetalle.precio_maximo) - Number(of.precio_ofertado) : 0;

                      return (
                        <div
                          key={of.id}
                          className={`p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                            esGanador ? 'bg-emerald-500/10' : 'bg-cd'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-xs text-[var(--tx)]">{prov?.nombre || 'Almacén'}</span>
                              {index === 0 && tienePrecio && (
                                <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                  · Mejor precio
                                </span>
                              )}
                              {esGanador && (
                                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                  · <Award size={11} /> Adjudicado
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] text-[var(--mu)] mt-0.5 flex flex-wrap items-center gap-2">
                              <span>Tel: {prov?.telefono || '—'}</span>
                              {of.tiempo_entrega && <span>· Entrega: {of.tiempo_entrega}</span>}
                              {of.cantidad_disponible && <span>· Disp: {of.cantidad_disponible} u</span>}
                            </div>
                            {of.notas && <p className="text-[11px] text-[var(--mu)] italic mt-1">"{of.notas}"</p>}
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                            <div className="text-right">
                              <span className="font-mono tabular-nums font-bold text-sm text-[var(--tx)] block">
                                {tienePrecio ? `$${Number(of.precio_ofertado).toFixed(2)}` : 'Sin respuesta'}
                              </span>
                              {ahorroUni > 0 && (
                                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium block font-mono tabular-nums">
                                  Ahorro -${ahorroUni.toFixed(2)}/u
                                </span>
                              )}
                            </div>

                            {tienePrecio && licitacionDetalle.estado !== 'completed' && (
                              <button
                                type="button"
                                onClick={() => handleAdjudicarOferta(licitacionDetalle, of)}
                                className="px-3 py-1.5 bg-[var(--tx)] text-[var(--cd)] rounded-lg text-xs font-semibold hover:opacity-90"
                              >
                                Adjudicar
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-[var(--bd)] bg-sf/40 flex justify-end">
              <button
                type="button"
                onClick={() => setLicitacionDetalle(null)}
                className="px-4 py-1.5 border border-[var(--bd)] bg-cd rounded-lg text-xs font-medium text-[var(--tx)]"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: NUEVA LICITACIÓN */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setIsModalOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
              <h2 className="text-sm font-semibold">Lanzar licitación masiva</h2>
              <button type="button" onClick={() => setIsModalOpen(false)} className="p-1 text-[var(--mu)] hover:text-[var(--tx)] rounded-lg"><X size={16} /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[var(--mu)] block mb-1">SKU o producto *</label>
                  <input
                    value={sku}
                    onChange={e => setSku(e.target.value.toUpperCase())}
                    placeholder="MINI-EMS-01"
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs uppercase font-mono font-semibold outline-none focus:border-[var(--tx)]"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-[var(--mu)] block mb-1">Cantidad requerida *</label>
                  <input
                    type="number"
                    min="1"
                    value={cantidad}
                    onChange={e => setCantidad(e.target.value)}
                    placeholder="50"
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs font-mono tabular-nums font-semibold outline-none focus:border-[var(--tx)]"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-[var(--mu)] block mb-1">URL foto del producto (opcional)</label>
                <input
                  value={imagenUrl}
                  onChange={e => setImagenUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none focus:border-[var(--tx)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[var(--mu)] block mb-1">Precio objetivo ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={precioRef}
                    onChange={e => setPrecioRef(e.target.value)}
                    placeholder="3.00"
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs font-mono tabular-nums font-semibold outline-none focus:border-[var(--tx)]"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-[var(--mu)] block mb-1">Precio máximo ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={precioMax}
                    onChange={e => setPrecioMax(e.target.value)}
                    placeholder="4.50"
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs font-mono tabular-nums font-semibold outline-none focus:border-[var(--tx)]"
                  />
                </div>
              </div>

              <div className="p-3.5 bg-sf border border-[var(--bd)] rounded-lg space-y-1.5">
                <span className="text-[11px] font-semibold text-[var(--mu)] block">
                  Vista previa de WhatsApp (Evolution API)
                </span>
                <div className="text-xs leading-relaxed text-[var(--tx)]">
                  <p>¡Hola! Tenemos orden de compra para <strong>{cantidad} unidades</strong> del producto <strong>{sku || '[SKU]'}</strong>.</p>
                  <p className="mt-1">Rango objetivo de compra: <strong>${precioRef || '0.00'} - ${precioMax || '0.00'} USD</strong>.</p>
                  <p className="mt-1">¿Cuentan con disponibilidad para entrega inmediata? Por favor responde con tu mejor cotización y disponibilidad.</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 p-3 bg-sf rounded-lg border border-[var(--bd)]">
                <input
                  type="checkbox"
                  id="modoPrueba"
                  checked={modoPrueba}
                  onChange={e => setModoPrueba(e.target.checked)}
                  className="rounded focus:ring-0"
                />
                <label htmlFor="modoPrueba" className="text-xs cursor-pointer">
                  <span className="font-semibold text-[var(--tx)] block">Modo prueba (simulación)</span>
                  <span className="text-[11px] text-[var(--mu)] block">Envía únicamente a almacenes con etiqueta TEST.</span>
                </label>
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-[var(--bd)]">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border border-[var(--bd)] rounded-lg text-xs font-medium text-[var(--tx)] hover:bg-sf"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGuardarLicitacion}
                disabled={saving}
                className="px-5 py-2 bg-[var(--tx)] text-[var(--cd)] font-semibold rounded-lg text-xs hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Encolando...' : `Disparar licitación (${selectedIds.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CREAR / EDITAR PROVEEDOR */}
      {isProviderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setIsProviderModalOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
              <h2 className="text-sm font-semibold">
                {editingProviderId ? 'Editar proveedor' : 'Nuevo proveedor'}
              </h2>
              <button type="button" onClick={() => setIsProviderModalOpen(false)} className="p-1 text-[var(--mu)] hover:text-[var(--tx)] rounded-lg"><X size={16} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[var(--mu)] block mb-1">Nombre del almacén *</label>
                <input
                  value={provNombre}
                  onChange={e => setProvNombre(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none focus:border-[var(--tx)]"
                  placeholder="Importadora El Ángel"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-[var(--mu)] block mb-1">Teléfono WhatsApp</label>
                <input
                  value={provTelefono}
                  onChange={e => setProvTelefono(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs font-mono outline-none focus:border-[var(--tx)]"
                  placeholder="+503 7777 8888"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-[var(--mu)] block mb-1">Etiquetas (separadas por coma)</label>
                <input
                  value={provEtiquetas}
                  onChange={e => setProvEtiquetas(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none focus:border-[var(--tx)]"
                  placeholder="tecnologia, mayorista, san_salvador"
                />
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-[var(--bd)]">
              <button
                type="button"
                onClick={() => setIsProviderModalOpen(false)}
                className="px-4 py-2 border border-[var(--bd)] rounded-lg text-xs font-medium text-[var(--tx)] hover:bg-sf"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveProvider}
                disabled={saving}
                className="px-5 py-2 bg-[var(--tx)] text-[var(--cd)] font-semibold rounded-lg text-xs hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar proveedor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: REGISTRAR PUJA MANUAL */}
      {modalNuevaOferta && licitacionDetalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setModalNuevaOferta(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
              <h3 className="font-semibold text-sm">Registrar oferta de almacén</h3>
              <button type="button" onClick={() => setModalNuevaOferta(false)} className="p-1 text-[var(--mu)] hover:text-[var(--tx)] rounded-lg"><X size={16} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[var(--mu)] block mb-1">Almacén que cotizó *</label>
                <select
                  value={ofertaProveedorId}
                  onChange={e => setOfertaProveedorId(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none focus:border-[var(--tx)]"
                  required
                >
                  <option value="">Selecciona el almacén...</option>
                  {proveedores.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[var(--mu)] block mb-1">Precio ofertado ($/u) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={ofertaPrecio}
                    onChange={e => setOfertaPrecio(e.target.value)}
                    placeholder="3.25"
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs font-mono tabular-nums font-semibold outline-none focus:border-[var(--tx)]"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-[var(--mu)] block mb-1">Cantidad disponible</label>
                  <input
                    type="number"
                    min="1"
                    value={ofertaCantidad}
                    onChange={e => setOfertaCantidad(e.target.value)}
                    placeholder={String(licitacionDetalle.cantidad)}
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs font-mono tabular-nums font-semibold outline-none focus:border-[var(--tx)]"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-[var(--mu)] block mb-1">Tiempo de entrega</label>
                <input
                  type="text"
                  value={ofertaTiempo}
                  onChange={e => setOfertaTiempo(e.target.value)}
                  placeholder="Hoy 3pm, 24 horas"
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none focus:border-[var(--tx)]"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-[var(--mu)] block mb-1">Notas / Condiciones</label>
                <input
                  type="text"
                  value={ofertaNotas}
                  onChange={e => setOfertaNotas(e.target.value)}
                  placeholder="Incluye flete, pago contra entrega..."
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none focus:border-[var(--tx)]"
                />
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-[var(--bd)]">
              <button
                type="button"
                onClick={() => setModalNuevaOferta(false)}
                className="px-4 py-2 border border-[var(--bd)] rounded-lg text-xs font-medium text-[var(--tx)] hover:bg-sf"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGuardarPujaManual}
                className="px-5 py-2 bg-[var(--tx)] text-[var(--cd)] font-semibold rounded-lg text-xs hover:opacity-90"
              >
                Guardar puja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
