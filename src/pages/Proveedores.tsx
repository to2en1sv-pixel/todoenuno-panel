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
    <div className="max-w-6xl mx-auto flex flex-col gap-5 pb-14 min-h-screen">
      {/* HEADER PRINCIPAL */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div className="min-w-0 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="text-orange-500 shrink-0" size={24} />
            <h1 className="text-xl sm:text-2xl font-black tracking-tight whitespace-normal sm:whitespace-nowrap">
              Centro de Proveedores & Subasta Inversa
            </h1>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 border border-orange-500/30 shrink-0">
              n8n + Evolution API
            </span>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1 max-w-xl">
            Licitación masiva a almacenes por WhatsApp, comparador de precios en vivo y registro de adjudicaciones.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          <button
            onClick={handleOpenNewProvider}
            className="flex-1 sm:flex-none px-3.5 py-2 border border-[var(--bd)] bg-sf hover:bg-cd rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus size={15} /> + Proveedor
          </button>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex-1 sm:flex-none px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow transition-colors"
          >
            <Send size={14} /> Lanzar Licitación ({selectedIds.size})
          </button>
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between border ${
          message.type === 'ok' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' 
            : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
        }`}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="p-1 hover:opacity-70"><X size={14} /></button>
        </div>
      )}

      {/* TARJETAS KPI DE COMPRAS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Almacenes Registrados</span>
          <div className="text-2xl font-black mt-1 text-[var(--tx)]">
            {proveedores.length} <span className="text-xs font-normal tx-mu">contactos</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Conexión directa por WhatsApp</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Licitaciones Activas</span>
          <div className="text-2xl font-black mt-1 text-orange-500">
            {kpisLicitaciones.activas} <span className="text-xs font-normal tx-mu">en curso</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Esperando pujas de almacenes</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Compras Adjudicadas</span>
          <div className="text-2xl font-black mt-1 text-emerald-500">
            {kpisLicitaciones.completadas} <span className="text-xs font-normal tx-mu">cerradas</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Subastas ganadas con éxito</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Ahorro Generado por Subasta</span>
          <div className="text-2xl font-black mt-1 text-emerald-600 font-mono">
            ${kpisLicitaciones.ahorroTotal.toFixed(2)} <span className="text-xs font-normal tx-mu">USD</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Presupuesto máx vs Precio real</span>
        </div>
      </div>

      {/* SELECTOR DE PESTAÑAS */}
      <div className="flex bg-cd p-2 rounded-2xl border border-[var(--bd)] gap-1 text-xs font-bold overflow-x-auto">
        <button
          onClick={() => setTab('proveedores')}
          className={`px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            tab === 'proveedores' ? 'bg-sf shadow text-[var(--tx)]' : 'tx-mu hover:text-[var(--tx)]'
          }`}
        >
          <Building2 size={14} /> Red de Almacenes ({proveedores.length})
        </button>

        <button
          onClick={() => setTab('licitaciones')}
          className={`px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            tab === 'licitaciones' ? 'bg-orange-500 text-white shadow' : 'text-orange-600 hover:bg-orange-500/10'
          }`}
        >
          <Send size={14} /> Licitaciones & Comparador de Ofertas ({licitaciones.length})
        </button>

        <button
          onClick={() => setTab('scorecard')}
          className={`px-4 py-2 rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            tab === 'scorecard' ? 'bg-sf shadow text-[var(--tx)]' : 'tx-mu hover:text-[var(--tx)]'
          }`}
        >
          <BarChart3 size={14} /> Scorecard & Inteligencia ({scorecardProveedores.length})
        </button>
      </div>

      {/* ========================================================================= */}
      {/* PESTAÑA 1: RED DE PROVEEDORES Y SEGMENTACIÓN POR NICHOS                   */}
      {/* ========================================================================= */}
      {tab === 'proveedores' && (
        <div className="space-y-4">
          {/* Barra de Filtros y Segmentación Rápida por Nicho */}
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-cd p-3 rounded-2xl border border-[var(--bd)]">
            <div className="relative flex-1 sm:max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 tx-mu" />
              <input
                type="text"
                placeholder="Buscar por almacén o teléfono..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-sf border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-orange-500"
              />
            </div>

            {/* Chips de Etiquetas Rápidas */}
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs py-1">
              <span className="text-[10px] font-bold uppercase tx-mu shrink-0">Nicho:</span>
              <button
                onClick={() => setTagFiltro('todos')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  tagFiltro === 'todos' ? 'bg-slate-900 text-white' : 'bg-sf border border-[var(--bd)] tx-mu'
                }`}
              >
                Todos
              </button>
              {todasLasEtiquetas.map(t => (
                <button
                  key={t}
                  onClick={() => {
                    setTagFiltro(t);
                    seleccionarPorEtiqueta(t);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    tagFiltro === t 
                      ? 'bg-orange-500 text-white shadow-sm' 
                      : 'bg-sf border border-[var(--bd)] text-orange-600 hover:bg-orange-500/10'
                  }`}
                  title={`Haz clic para filtrar y preseleccionar almacenes con #${t}`}
                >
                  #{t}
                </button>
              ))}
            </div>
          </div>

          {/* Tabla de Proveedores */}
          <div className="bg-cd border border-[var(--bd)] rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-sf border-b border-[var(--bd)] text-[10px] tx-mu uppercase font-bold">
                  <tr>
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.size > 0 && selectedIds.size === filteredProveedores.length}
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                    </th>
                    <th className="p-3">Almacén / Proveedor</th>
                    <th className="p-3">Teléfono WhatsApp</th>
                    <th className="p-3">Especialidad / Etiquetas</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--bd)]">
                  {filteredProveedores.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center tx-mu">
                        No se encontraron almacenes con estos filtros.
                      </td>
                    </tr>
                  ) : (
                    filteredProveedores.map(p => {
                      const isSelected = selectedIds.has(p.id);

                      return (
                        <tr key={p.id} className={`hover:bg-sf/50 transition-colors ${isSelected ? 'bg-orange-500/5' : ''}`}>
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(p.id)}
                              className="rounded"
                            />
                          </td>
                          <td className="p-3 font-bold text-[var(--tx)]">
                            {p.nombre}
                          </td>
                          <td className="p-3 font-mono tx-mu">
                            {p.telefono || '—'}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              {(p.etiquetas || []).map(t => (
                                <span key={t} className="px-2 py-0.5 rounded-md bg-sf border border-[var(--bd)] text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                  #{t}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="p-3 text-right whitespace-nowrap">
                            <button
                              onClick={() => handleOpenEditProvider(p)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 transition-colors mr-1"
                              title="Editar"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteProvider(p.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 size={14} />
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

      {/* ========================================================================= */}
      {/* PESTAÑA 2: SUBASTAS EN VIVO & COMPARADOR DE OFERTAS                       */}
      {/* ========================================================================= */}
      {tab === 'licitaciones' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {licitaciones.length === 0 ? (
              <div className="col-span-full py-16 text-center tx-mu bg-cd rounded-2xl border border-[var(--bd)]">
                No hay licitaciones registradas aún. Presiona "+ Lanzar Licitación" para empezar.
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
                    className="bg-cd border border-[var(--bd)] rounded-2xl p-4 flex flex-col justify-between hover:border-orange-500 hover:shadow-md transition-all cursor-pointer group"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[10px] font-mono tx-mu uppercase">
                          {new Date(lic.created_at).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}
                        </span>

                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          esCompletada 
                            ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' 
                            : 'bg-orange-500/10 text-orange-600 border border-orange-500/20 animate-pulse'
                        }`}>
                          {esCompletada ? '✓ Adjudicada' : 'Subasta Activa'}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 mt-3">
                        <div className="w-12 h-12 rounded-xl bg-sf border border-[var(--bd)] overflow-hidden shrink-0 flex items-center justify-center">
                          {lic.imagen_url ? (
                            <img src={lic.imagen_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xl">📦</span>
                          )}
                        </div>

                        <div className="min-w-0">
                          <h3 className="font-bold text-sm text-[var(--tx)] truncate">{lic.sku}</h3>
                          <span className="text-xs font-semibold tx-mu block">
                            Buscando: {lic.cantidad} unidades
                          </span>
                        </div>
                      </div>

                      {/* Rango de Precios Objetivo */}
                      <div className="mt-3 p-2 bg-sf rounded-xl border border-[var(--bd)] flex items-center justify-between text-xs">
                        <div>
                          <span className="text-[9px] uppercase font-bold tx-mu block">P. Objetivo</span>
                          <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                            ${lic.precio_referencia ? Number(lic.precio_referencia).toFixed(2) : '—'}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] uppercase font-bold tx-mu block">P. Máximo</span>
                          <span className="font-mono font-bold text-rose-600">
                            ${lic.precio_maximo ? Number(lic.precio_maximo).toFixed(2) : '—'}
                          </span>
                        </div>
                      </div>

                      {/* Estado de Respuestas de n8n / Evolution API */}
                      <div className="mt-3 text-xs">
                        <div className="flex justify-between items-center text-[11px] mb-1">
                          <span className="tx-mu">Almacenes contactados:</span>
                          <span className="font-bold font-mono text-[var(--tx)]">{ofertasDeEsta.length}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="tx-mu">Cotizaciones recibidas:</span>
                          <span className="font-bold font-mono text-emerald-600">{ofertasRespondidas.length}</span>
                        </div>
                      </div>

                      {/* Ganador o Mejor Oferta Actual */}
                      <div className="mt-3 pt-2.5 border-t border-[var(--bd)]">
                        {esCompletada && provGanador ? (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[11px] text-emerald-600 font-bold flex items-center gap-1">
                              <Award size={13} /> Ganador: {provGanador.nombre}
                            </span>
                            <span className="font-mono font-black text-emerald-600">
                              ${Number(lic.precio_adjudicado || 0).toFixed(2)}
                            </span>
                          </div>
                        ) : mejorOferta ? (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[11px] text-orange-600 font-bold flex items-center gap-1">
                              🔥 Mejor oferta actual:
                            </span>
                            <span className="font-mono font-black text-emerald-600">
                              ${Number(mejorOferta.precio_ofertado).toFixed(2)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] tx-mu italic">Esperando respuestas de Evolution API...</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 pt-2 flex items-center justify-end text-xs font-bold text-orange-600 group-hover:underline">
                      Comparar Ofertas →
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PESTAÑA 3: SCORECARD & INTELIGENCIA DE COMPRAS                            */}
      {/* ========================================================================= */}
      {tab === 'scorecard' && (
        <div className="space-y-4">
          <div className="p-4 bg-cd rounded-2xl border border-[var(--bd)]">
            <h3 className="font-black text-sm text-[var(--tx)]">Scorecard de Confiabilidad de Almacenes</h3>
            <p className="text-xs tx-mu mt-0.5">
              Mide la rapidez y efectividad con la que cada almacén responde tus licitaciones de WhatsApp y quién te ofrece los precios más competitivos.
            </p>
          </div>

          <div className="bg-cd border border-[var(--bd)] rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-sf border-b border-[var(--bd)] text-[10px] tx-mu uppercase font-bold">
                  <tr>
                    <th className="p-3">Almacén</th>
                    <th className="p-3 text-center">Licitaciones Recibidas</th>
                    <th className="p-3 text-center">Respuestas Enviadas</th>
                    <th className="p-3 text-center">Tasa de Respuesta</th>
                    <th className="p-3 text-center">Compras Ganadas</th>
                    <th className="p-3 text-right">Mejor Precio Histórico</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--bd)]">
                  {scorecardProveedores.map((sc, idx) => {
                    const tasa = sc.totalInvitaciones > 0 ? (sc.totalRespuestas / sc.totalInvitaciones) * 100 : 0;
                    const esTop = sc.adjudicacionesGanadas > 0 && idx === 0;

                    return (
                      <tr key={sc.proveedor.id} className="hover:bg-sf/50 transition-colors">
                        <td className="p-3">
                          <div className="font-bold text-[var(--tx)] flex items-center gap-1.5">
                            {sc.proveedor.nombre}
                            {esTop && (
                              <span className="px-1.5 py-0.2 bg-amber-500/10 text-amber-600 text-[9px] font-bold rounded border border-amber-500/20">
                                🏆 Top Proveedor
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] tx-mu font-mono">{sc.proveedor.telefono || '—'}</span>
                        </td>
                        <td className="p-3 text-center font-mono font-semibold">
                          {sc.totalInvitaciones}
                        </td>
                        <td className="p-3 text-center font-mono font-semibold">
                          {sc.totalRespuestas}
                        </td>
                        <td className="p-3 text-center font-mono font-bold">
                          <span className={`px-2 py-0.5 rounded-full ${
                            tasa >= 75 ? 'bg-emerald-500/10 text-emerald-600' : tasa >= 40 ? 'bg-amber-500/10 text-amber-600' : 'bg-slate-500/10 tx-mu'
                          }`}>
                            {tasa.toFixed(0)}%
                          </span>
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-emerald-600">
                          {sc.adjudicacionesGanadas}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                          {sc.mejorPrecioHistorico > 0 ? `$${sc.mejorPrecioHistorico.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: COMPARADOR DE OFERTAS & ADJUDICACIÓN DE SUBASTA                   */}
      {/* ========================================================================= */}
      {licitacionDetalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setLicitacionDetalle(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl flex flex-col">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-cd border border-[var(--bd)] overflow-hidden shrink-0 flex items-center justify-center">
                  {licitacionDetalle.imagen_url ? (
                    <img src={licitacionDetalle.imagen_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl">📦</span>
                  )}
                </div>
                <div>
                  <span className="text-[10px] font-mono tx-mu uppercase">Subasta Inversa #{licitacionDetalle.sku}</span>
                  <h3 className="font-bold text-sm text-[var(--tx)]">Requerimiento: {licitacionDetalle.cantidad} unidades</h3>
                </div>
              </div>

              <button onClick={() => setLicitacionDetalle(null)} className="p-1.5 hover:bg-black/10 rounded-lg">
                <X size={18} />
              </button>
            </div>

            {/* Contenido Comparador */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {/* Resumen de Presupuesto */}
              <div className="grid grid-cols-3 gap-3 p-3 bg-sf rounded-xl border border-[var(--bd)] text-center text-xs">
                <div>
                  <span className="text-[10px] tx-mu uppercase font-bold block">Precio Ref. Objetivo</span>
                  <span className="font-mono font-bold text-sm text-[var(--tx)]">
                    ${licitacionDetalle.precio_referencia ? Number(licitacionDetalle.precio_referencia).toFixed(2) : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] tx-mu uppercase font-bold block">Precio Máximo Límite</span>
                  <span className="font-mono font-bold text-sm text-rose-600">
                    ${licitacionDetalle.precio_maximo ? Number(licitacionDetalle.precio_maximo).toFixed(2) : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] tx-mu uppercase font-bold block">Presupuesto Máximo</span>
                  <span className="font-mono font-black text-sm text-[var(--tx)]">
                    ${((licitacionDetalle.cantidad || 1) * Number(licitacionDetalle.precio_maximo || 0)).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Lista de Pujas / Ofertas de Almacenes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tx-mu flex items-center gap-1.5">
                    <TrendingDown size={14} className="text-emerald-500" /> Comparador de Pujas Recibidas (Ordenadas por menor precio)
                  </h4>

                  <button
                    onClick={() => setModalNuevaOferta(true)}
                    className="px-2.5 py-1 bg-sf border border-[var(--bd)] hover:bg-cd rounded-lg text-[11px] font-bold text-orange-600 flex items-center gap-1"
                  >
                    + Registrar Puja Manual
                  </button>
                </div>

                <div className="space-y-2">
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
                          className={`p-3.5 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-all ${
                            esGanador 
                              ? 'bg-emerald-500/10 border-emerald-500/40 ring-2 ring-emerald-500/30' 
                              : index === 0 && tienePrecio && licitacionDetalle.estado !== 'completed'
                              ? 'bg-orange-500/5 border-orange-500/40' 
                              : 'bg-sf border-[var(--bd)]'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-[var(--tx)]">{prov?.nombre || 'Almacén'}</span>
                              {index === 0 && tienePrecio && (
                                <span className="px-1.5 py-0.2 bg-emerald-500 text-white rounded text-[9px] font-black uppercase">
                                  Mejor Precio
                                </span>
                              )}
                              {esGanador && (
                                <span className="px-1.5 py-0.2 bg-emerald-600 text-white rounded text-[9px] font-black uppercase flex items-center gap-0.5">
                                  <Award size={10} /> Adjudicado
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] tx-mu mt-0.5 flex flex-wrap items-center gap-2">
                              <span>Tel: {prov?.telefono || '—'}</span>
                              {of.tiempo_entrega && <span>• Entrega: {of.tiempo_entrega}</span>}
                              {of.cantidad_disponible && <span>• Disp: {of.cantidad_disponible} u</span>}
                            </div>
                            {of.notas && <p className="text-[10px] tx-mu italic mt-1">"{of.notas}"</p>}
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                            <div className="text-right">
                              <span className="text-[9px] uppercase font-bold tx-mu block">Precio Ofertado</span>
                              <span className="font-mono font-black text-base text-[var(--tx)]">
                                {tienePrecio ? `$${Number(of.precio_ofertado).toFixed(2)}` : 'Sin respuesta'}
                              </span>
                              {ahorroUni > 0 && (
                                <span className="text-[10px] text-emerald-600 font-bold block">
                                  Ahorro: -${ahorroUni.toFixed(2)}/u
                                </span>
                              )}
                            </div>

                            {tienePrecio && licitacionDetalle.estado !== 'completed' && (
                              <button
                                onClick={() => handleAdjudicarOferta(licitacionDetalle, of)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-sm transition-colors"
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

            <div className="p-4 border-t border-[var(--bd)] bg-sf flex justify-end">
              <button
                onClick={() => setLicitacionDetalle(null)}
                className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: NUEVA LICITACIÓN CON VISTA PREVIA DE WHATSAPP                   */}
      {/* ========================================================================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setIsModalOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl p-5 md:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
              <div className="flex items-center gap-2">
                <Send className="text-orange-500" size={18} />
                <h2 className="text-base font-black">Lanzar Licitación Masiva</h2>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-1 rounded-lg hover:bg-black/10"><X size={16} /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold tx-mu block mb-1">SKU o Producto *</label>
                  <input
                    value={sku}
                    onChange={e => setSku(e.target.value.toUpperCase())}
                    placeholder="Ej: MINI-EMS-01"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs uppercase font-mono font-bold outline-none focus:border-orange-500"
                    required
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold tx-mu block mb-1">Cantidad Requerida *</label>
                  <input
                    type="number"
                    min="1"
                    value={cantidad}
                    onChange={e => setCantidad(e.target.value)}
                    placeholder="50"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none focus:border-orange-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold tx-mu block mb-1">URL Foto del Producto (Opcional)</label>
                <input
                  value={imagenUrl}
                  onChange={e => setImagenUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-orange-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold tx-mu block mb-1">Precio Referencia ($ Objetivo)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={precioRef}
                    onChange={e => setPrecioRef(e.target.value)}
                    placeholder="3.00"
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold tx-mu block mb-1">Precio Máximo ($ Límite)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={precioMax}
                    onChange={e => setPrecioMax(e.target.value)}
                    placeholder="4.50"
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              {/* VISTA PREVIA DEL MENSAJE DE WHATSAPP (EVOLUTION API) */}
              <div className="p-3.5 bg-emerald-950/10 dark:bg-emerald-900/20 border border-emerald-500/20 rounded-2xl space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block flex items-center gap-1">
                  <MessageSquare size={12} /> Vista Previa: Mensaje de WhatsApp (Evolution API)
                </span>
                <div className="p-3 bg-cd rounded-xl border border-[var(--bd)] text-xs font-sans leading-relaxed text-[var(--tx)]">
                  <p>¡Hola! 👋 Tenemos orden de compra para <strong>{cantidad} unidades</strong> del producto <strong>{sku || '[SKU]'}</strong>.</p>
                  <p className="mt-1">💰 Rango objetivo de compra: <strong>${precioRef || '0.00'} - ${precioMax || '0.00'} USD</strong>.</p>
                  <p className="mt-1">¿Cuentan con disponibilidad para entrega inmediata? Por favor responde con tu mejor cotización y disponibilidad.</p>
                </div>
              </div>

              {/* Checkbox Modo Prueba */}
              <div className="flex items-center gap-2 p-3 bg-sf rounded-xl border border-[var(--bd)]">
                <input
                  type="checkbox"
                  id="modoPrueba"
                  checked={modoPrueba}
                  onChange={e => setModoPrueba(e.target.checked)}
                  className="rounded text-orange-600 focus:ring-0"
                />
                <label htmlFor="modoPrueba" className="text-xs cursor-pointer">
                  <span className="font-bold text-[var(--tx)] block">Modo Prueba (Simulación)</span>
                  <span className="text-[10px] tx-mu block">Envía la licitación únicamente a almacenes con etiqueta "TEST".</span>
                </label>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-[var(--bd)]">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGuardarLicitacion}
                disabled={saving}
                className="px-5 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow"
              >
                {saving ? 'Encolando...' : `Disparar Licitación (${selectedIds.size} almacenes)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: CREAR / EDITAR PROVEEDOR                                        */}
      {/* ========================================================================= */}
      {isProviderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setIsProviderModalOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
              <h2 className="text-base font-black">
                {editingProviderId ? 'Editar Proveedor' : 'Nuevo Proveedor'}
              </h2>
              <button onClick={() => setIsProviderModalOpen(false)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase font-bold tx-mu block mb-1">Nombre del Almacén *</label>
                <input
                  value={provNombre}
                  onChange={e => setProvNombre(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-orange-500"
                  placeholder="Ej: Importadora El Ángel"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold tx-mu block mb-1">Teléfono WhatsApp</label>
                <input
                  value={provTelefono}
                  onChange={e => setProvTelefono(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-mono outline-none focus:border-orange-500"
                  placeholder="Ej: +503 7777 8888"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold tx-mu block mb-1">Etiquetas (separadas por coma)</label>
                <input
                  value={provEtiquetas}
                  onChange={e => setProvEtiquetas(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none focus:border-orange-500"
                  placeholder="tecnologia, mayorista, san_salvador"
                />
                <span className="text-[10px] tx-mu block mt-1">Úsalas para segmentar y licitar por nicho con 1 clic.</span>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-[var(--bd)]">
              <button
                type="button"
                onClick={() => setIsProviderModalOpen(false)}
                className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveProvider}
                disabled={saving}
                className="px-5 py-2 bg-slate-900 text-white font-bold rounded-xl text-xs"
              >
                {saving ? 'Guardando...' : 'Guardar Proveedor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: REGISTRAR PUJA MANUAL                                           */}
      {/* ========================================================================= */}
      {modalNuevaOferta && licitacionDetalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setModalNuevaOferta(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
              <h3 className="font-bold text-sm">Registrar Oferta de Almacén</h3>
              <button onClick={() => setModalNuevaOferta(false)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase font-bold tx-mu block mb-1">Almacén que Cotizó *</label>
                <select
                  value={ofertaProveedorId}
                  onChange={e => setOfertaProveedorId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
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
                  <label className="text-[10px] uppercase font-bold tx-mu block mb-1">Precio Ofertado ($/u) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={ofertaPrecio}
                    onChange={e => setOfertaPrecio(e.target.value)}
                    placeholder="3.25"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold tx-mu block mb-1">Cantidad Disponible</label>
                  <input
                    type="number"
                    min="1"
                    value={ofertaCantidad}
                    onChange={e => setOfertaCantidad(e.target.value)}
                    placeholder={String(licitacionDetalle.cantidad)}
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold tx-mu block mb-1">Tiempo de Entrega</label>
                <input
                  type="text"
                  value={ofertaTiempo}
                  onChange={e => setOfertaTiempo(e.target.value)}
                  placeholder="Ej. Hoy 3pm, 24 horas"
                  className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold tx-mu block mb-1">Notas / Condiciones</label>
                <input
                  type="text"
                  value={ofertaNotas}
                  onChange={e => setOfertaNotas(e.target.value)}
                  placeholder="Incluye flete, pago contra entrega..."
                  className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-[var(--bd)]">
              <button
                type="button"
                onClick={() => setModalNuevaOferta(false)}
                className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGuardarPujaManual}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs"
              >
                Guardar Puja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
