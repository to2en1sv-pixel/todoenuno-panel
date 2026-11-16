import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Users, 
  Sparkles, 
  TrendingUp, 
  DollarSign, 
  Zap, 
  MessageCircle, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  Filter, 
  Search, 
  Send, 
  ShieldAlert, 
  ShoppingBag, 
  ArrowUpRight, 
  Tag, 
  Gift, 
  Bot, 
  Flame, 
  Copy, 
  Check, 
  ChevronRight, 
  Layers, 
  RefreshCw,
  Plus,
  X,
  ExternalLink,
  Shield,
  Heart,
  Baby,
  UtensilsCrossed,
  Smartphone,
  Wrench,
  HeartPulse,
  Package
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { 
  procesarPerfilesLtv, 
  ClienteLtvProfile, 
  MetricasLTVGlobales, 
  CohorteCategoria, 
  CampanaOfertaFlash, 
  getCampanasFlash, 
  guardarCampanaFlash, 
  marcarDestinatarioEnviado, 
  generarMensajeOfertaFlash, 
  CATEGORIAS_CROSS_SELL, 
  SegmentoRFM 
} from '@/lib/ltv';
import { cleanPhone, formatPhoneDisplay } from '@/lib/blacklist';
import { formatCurrency } from '@/lib/rentabilidad';
import { useProductos } from '@/hooks/useCatalog';

export function LtvPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [campanas, setCampanas] = useState<CampanaOfertaFlash[]>(() => getCampanasFlash());

  // Tabs
  type TabKey = 'cohortes' | 'campanas' | 'directorio' | 'bot';
  const [activeTab, setActiveTab] = useState<TabKey>('cohortes');

  // Filtros Directorio
  const [busqueda, setBusqueda] = useState('');
  const [filtroSegmento, setFiltroSegmento] = useState<string>('todos');

  // Modales
  const [modalNuevaCampana, setModalNuevaCampana] = useState(false);
  const [cohorteSeleccionado, setCohorteSeleccionado] = useState<CohorteCategoria | null>(null);

  // Modal WhatsApp Individual
  const [clienteAEnviar, setClienteAEnviar] = useState<ClienteLtvProfile | null>(null);
  const [copiadoIndividual, setCopiadoIndividual] = useState(false);

  // Formulario Nueva Campaña Flash
  const [tituloCampana, setTituloCampana] = useState('');
  const [catSeleccionadaId, setCatSeleccionadaId] = useState('maternidad_bebes');
  const [productoOfertado, setProductoOfertado] = useState('');
  const [precioRegular, setPrecioRegular] = useState('22.00');
  const [precioFlash, setPrecioFlash] = useState('14.99');
  const [cuponCodigo, setCuponCodigo] = useState('');
  const [vigenciaHoras, setVigenciaHoras] = useState(48);
  const [beneficioExtra, setBeneficioExtra] = useState('Envío Gratis a todo El Salvador (Pago Contra Entrega)');
  const [pitchPersonalizado, setPitchPersonalizado] = useState('');
  const [copiadoPreview, setCopiadoPreview] = useState(false);

  // Catálogo disponible para autocompletar si se desea
  const { data: productosCatalogo } = useProductos();

  /* --------------------------- Carga de Datos --------------------------- */
  const cargarOrdenes = useCallback(async (silencioso = false) => {
    if (silencioso) setRefreshing(true);
    else setLoading(true);

    try {
      const { data, error } = await supabase
        .from('whatsapp_orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        setOrders(data);
      }
    } catch (err) {
      console.warn('Error al cargar órdenes para LTV:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    cargarOrdenes();
  }, [cargarOrdenes]);

  // Recargar campañas cuando haya eventos
  useEffect(() => {
    const handleUpdate = () => setCampanas(getCampanasFlash());
    window.addEventListener('ltv_campaigns_updated', handleUpdate);
    return () => window.removeEventListener('ltv_campaigns_updated', handleUpdate);
  }, []);

  /* --------------------------- Procesamiento LTV --------------------------- */
  const { perfiles, metricas, cohortes } = useMemo(() => {
    return procesarPerfilesLtv(orders);
  }, [orders]);

  // Filtrado de perfiles en directorio
  const perfilesFiltrados = useMemo(() => {
    return perfiles.filter(p => {
      const matchText = 
        p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
        p.telefono.includes(busqueda.trim());

      const matchSeg = 
        filtroSegmento === 'todos' ||
        (filtroSegmento === 'vip' && p.segmentoRFM === 'vip_campeon') ||
        (filtroSegmento === 'fiel' && p.segmentoRFM === 'comprador_fiel') ||
        (filtroSegmento === 'listo' && p.segmentoRFM === 'listo_cross_sell') ||
        (filtroSegmento === 'riesgo' && p.segmentoRFM === 'en_riesgo') ||
        (filtroSegmento === 'bloqueado' && (p.enListaNegra || p.segmentoRFM === 'bloqueado'));

      return matchText && matchSeg;
    });
  }, [perfiles, busqueda, filtroSegmento]);

  /* --------------------------- Handlers de Campaña --------------------------- */
  const handleAbrirCrearCampana = (cohorte?: CohorteCategoria) => {
    const cat = cohorte || cohortes[0] || CATEGORIAS_CROSS_SELL[0];
    setCatSeleccionadaId(cat.id);
    setTituloCampana(`Venta Privada: ${cat.nombre}`);
    setProductoOfertado(cat.productoRecomendadoDefault);
    setPrecioRegular(cat.precioRegularDefault.toFixed(2));
    setPrecioFlash(cat.precioFlashDefault.toFixed(2));
    setPitchPersonalizado(cat.pitchCrossSell);
    setCuponCodigo(`VIP-${cat.id.slice(0, 4).toUpperCase()}${new Date().getFullYear() % 100}`);
    setVigenciaHoras(48);
    setModalNuevaCampana(true);
  };

  const mensajePreviewCampana = useMemo(() => {
    return generarMensajeOfertaFlash({
      nombreCliente: '[Nombre del Cliente]',
      productoOfertado: productoOfertado || 'Producto Recomendado VIP',
      productoAnterior: 'tu compra anterior con nosotros',
      precioRegular: parseFloat(precioRegular) || 20,
      precioFlash: parseFloat(precioFlash) || 12.99,
      cuponCodigo: cuponCodigo || 'VIP2026',
      vigenciaHoras,
      beneficioExtra,
      pitchPersonalizado
    });
  }, [productoOfertado, precioRegular, precioFlash, cuponCodigo, vigenciaHoras, beneficioExtra, pitchPersonalizado]);

  // Error inline para formulario
  const [formError, setFormError] = useState<string | null>(null);

  const handleGuardarNuevaCampana = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productoOfertado.trim()) {
      setFormError('Por favor ingresa el producto ofertado.');
      return;
    }
    setFormError(null);

    // Obtener los clientes del cohorte seleccionado
    const clientesCat = perfiles.filter(p => 
      (catSeleccionadaId === 'todas_vip' ? p.segmentoRFM === 'vip_campeon' : p.categoriaPrincipal === catSeleccionadaId) && 
      !p.enListaNegra && 
      p.pedidosEntregados >= 1
    );

    const catObj = CATEGORIAS_CROSS_SELL.find(c => c.id === catSeleccionadaId);

    guardarCampanaFlash({
      titulo: tituloCampana.trim() || `Oferta Flash ${catObj?.nombre || 'Especial'}`,
      categoriaId: catSeleccionadaId,
      categoriaNombre: catObj?.nombre || 'Clientes Seleccionados',
      productoOfertado: productoOfertado.trim(),
      precioRegular: parseFloat(precioRegular) || 20,
      precioFlash: parseFloat(precioFlash) || 12.99,
      cuponCodigo: cuponCodigo.trim() || 'VIP2026',
      vigenciaHoras,
      beneficioExtra,
      mensajePlantilla: pitchPersonalizado,
      totalDestinatarios: clientesCat.length,
      destinatariosEnviados: [],
      estado: 'activa'
    });

    setModalNuevaCampana(false);
    setActiveTab('campanas');
  };

  // Enviar mensaje individual desde el modal
  const handleEnviarIndividual = (cliente: ClienteLtvProfile) => {
    const mensaje = generarMensajeOfertaFlash({
      nombreCliente: cliente.nombre,
      productoOfertado: cliente.proximaNecesidadEstimada?.productoRecomendado || 'Set Exclusivo VIP',
      productoAnterior: cliente.productosComprados[0]?.nombre || 'tu pedido anterior',
      precioRegular: cliente.proximaNecesidadEstimada?.precioRegular || 22.00,
      precioFlash: cliente.proximaNecesidadEstimada?.precioFlash || 14.99,
      cuponCodigo: `VIP-${cliente.telefono.slice(-4)}`,
      vigenciaHoras: 48,
      beneficioExtra: 'Envío Gratis a todo El Salvador (Pago Contra Entrega)',
      pitchPersonalizado: cliente.proximaNecesidadEstimada?.razonLogica
    });

    const encoded = encodeURIComponent(mensaje);
    window.open(`https://wa.me/503${cliente.telefono}?text=${encoded}`, '_blank');
  };

  // Helper para renderizar iconos de categoría
  const renderIconoCat = (catId: string, size = 16) => {
    switch (catId) {
      case 'maternidad_bebes': return <Baby size={size} className="tx-mu" />;
      case 'hogar_cocina': return <UtensilsCrossed size={size} className="tx-mu" />;
      case 'belleza_cuidado': return <Sparkles size={size} className="tx-mu" />;
      case 'tecnologia_gadgets': return <Smartphone size={size} className="tx-mu" />;
      case 'herramientas_auto': return <Wrench size={size} className="tx-mu" />;
      case 'fitness_salud': return <HeartPulse size={size} className="tx-mu" />;
      default: return <Package size={size} className="tx-mu" />;
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-16">
      {/* --------------------------- HEADER PRINCIPAL --------------------------- */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
            Fidelización &amp; LTV Predictivo
          </h1>
          <p className="text-xs tx-mu mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
            <span>COD Retention Engine</span>
            <span aria-hidden="true">·</span>
            <span>Cross-Sell B2C</span>
            <span aria-hidden="true">·</span>
            <span>{perfiles.length} clientes analizados</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => cargarOrdenes(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--bd)] bg-cd text-xs font-medium tx-mu hover:text-[var(--tx)] transition-colors cursor-pointer"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            <span>Actualizar</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setFormError(null);
              handleAbrirCrearCampana();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--tx)] text-[var(--cd)] px-3.5 py-2 text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap cursor-pointer"
          >
            <Zap size={13} />
            <span>Nueva Oferta Flash</span>
          </button>
        </div>
      </header>

      {/* --------------------------- KPI METRICS BAR --------------------------- */}
      <section className="bg-cd border border-[var(--bd)] rounded-xl grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 divide-y md:divide-y-0 md:divide-x divide-[var(--bd)] overflow-hidden">
        <div className="p-4">
          <div className="text-[11px] font-medium tx-mu">Clientes únicos</div>
          <div className="text-xl font-bold font-mono tabular-nums mt-1 text-[var(--tx)]">
            {loading ? '—' : metricas.totalClientesUnicos}
          </div>
          <div className="text-[11px] tx-mu mt-0.5">Base activa con compras</div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium tx-mu">Tasa recompra</div>
          <div className="text-xl font-bold font-mono tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">
            {loading ? '—' : `${metricas.tasaRecompra.toFixed(1)}%`}
          </div>
          <div className="text-[11px] tx-mu mt-0.5 tabular-nums">{metricas.clientesConRecompra} recurrentes</div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium tx-mu">LTV promedio</div>
          <div className="text-xl font-bold font-mono tabular-nums mt-1 text-[var(--tx)]">
            {loading ? '—' : `$${metricas.ltvPromedio.toFixed(2)}`}
          </div>
          <div className="text-[11px] tx-mu mt-0.5 font-mono tabular-nums">
            Ticket: ${metricas.ticketPromedioGeneral.toFixed(2)}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium tx-mu">Listos oferta flash</div>
          <div className="text-xl font-bold font-mono tabular-nums mt-1 text-amber-600 dark:text-amber-400">
            {loading ? '—' : metricas.clientesListosOferta}
          </div>
          <div className="text-[11px] tx-mu mt-0.5">Ventana de maduración</div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium tx-mu">Clientes VIP</div>
          <div className="text-xl font-bold font-mono tabular-nums mt-1 text-[var(--tx)]">
            {loading ? '—' : metricas.clientesVip}
          </div>
          <div className="text-[11px] tx-mu mt-0.5">2+ pedidos · Alto valor</div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium tx-mu">Excluidos DICOM</div>
          <div className="text-xl font-bold font-mono tabular-nums mt-1 text-rose-600 dark:text-rose-400">
            {loading ? '—' : metricas.clientesExcluidosFraude}
          </div>
          <div className="text-[11px] tx-mu mt-0.5">0% gasto en canceladores</div>
        </div>
      </section>

      {/* --------------------------- TABS DE NAVEGACIÓN --------------------------- */}
      <nav className="flex items-center gap-5 border-b border-[var(--bd)] overflow-x-auto">
        {(
          [
            { id: 'cohortes', label: 'Cohortes & Cross-Sell' },
            { id: 'campanas', label: `Campañas Flash (${campanas.length})` },
            { id: 'directorio', label: `Directorio & RFM (${perfiles.length})` },
            { id: 'bot', label: 'Bot Logístico & Reglas' },
          ] as const
        ).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`pb-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'border-[var(--tx)] text-[var(--tx)] font-semibold'
                  : 'border-transparent tx-mu hover:text-[var(--tx)]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* --------------------------- CONTENIDO DE TABS --------------------------- */}

      {/* TAB 1: COHORTES & CROSS-SELL PREDICTIVO */}
      {activeTab === 'cohortes' && (
        <div className="flex flex-col gap-5">
          <div className="bg-cd border border-[var(--bd)] p-4 sm:p-5 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--tx)] flex flex-wrap items-center gap-2">
                <span>Inteligencia de necesidad futura por ciclo de vida</span>
                <span className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  · Potencial ~${metricas.potencialVentasCrossSell.toFixed(0)} USD
                </span>
              </h2>
              <p className="text-xs tx-mu mt-1">
                Detecta clientes por categoría comprada y calcula el momento óptimo para el siguiente producto complementario.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleAbrirCrearCampana()}
              className="px-3.5 py-2 bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Zap size={13} />
              <span>Crear oferta flash</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cohortes.map(cohorte => (
              <div 
                key={cohorte.id} 
                className="bg-cd border border-[var(--bd)] rounded-xl p-5 flex flex-col justify-between hover:border-[var(--tx)]/30 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-lg bg-sf border border-[var(--bd)] flex items-center justify-center shrink-0">
                        {renderIconoCat(cohorte.id, 17)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm text-[var(--tx)] leading-tight">{cohorte.nombre}</h3>
                        <span className="text-[11px] tx-mu font-mono tabular-nums">Ventana: {cohorte.diasMaduracion}d</span>
                      </div>
                    </div>

                    <span className={`text-[11px] font-mono tabular-nums font-semibold ${
                      cohorte.clientesMaduros > 0 
                        ? 'text-amber-600 dark:text-amber-400' 
                        : 'tx-mu'
                    }`}>
                      {cohorte.clientesMaduros} listos
                    </span>
                  </div>

                  <p className="text-xs tx-mu leading-relaxed">
                    {cohorte.descripcion}
                  </p>

                  <div className="p-3 bg-sf rounded-lg border border-[var(--bd)] space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium tx-mu">Siguiente producto</span>
                      <span className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                        ${cohorte.precioFlashDefault.toFixed(2)}{' '}
                        <span className="line-through text-[10px] tx-mu">${cohorte.precioRegularDefault.toFixed(2)}</span>
                      </span>
                    </div>
                    <div className="font-semibold text-xs text-[var(--tx)]">
                      {cohorte.productoRecomendadoDefault}
                    </div>
                    <p className="text-[11px] tx-mu italic leading-snug">
                      &ldquo;{cohorte.pitchCrossSell}&rdquo;
                    </p>
                  </div>
                </div>

                <div className="pt-3.5 border-t border-[var(--bd)] mt-4 flex items-center justify-between gap-2">
                  <div className="text-xs tx-mu tabular-nums">
                    <strong className="text-[var(--tx)] font-mono">{cohorte.totalClientes}</strong> en cohorte
                  </div>

                  <button
                    type="button"
                    onClick={() => handleAbrirCrearCampana(cohorte)}
                    className="px-3 py-1.5 bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-opacity cursor-pointer"
                  >
                    <Zap size={12} />
                    <span>Lanzar oferta</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: CAMPAÑAS DE OFERTAS FLASH */}
      {activeTab === 'campanas' && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-cd p-4 sm:p-5 rounded-xl border border-[var(--bd)]">
            <div>
              <h2 className="text-sm font-semibold text-[var(--tx)]">
                Historial de campañas flash B2C ({campanas.length})
              </h2>
              <p className="text-xs tx-mu mt-0.5">
                Envía ofertas exclusivas por WhatsApp con vigencia de 48h a cohortes segmentados.
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleAbrirCrearCampana()}
              className="px-3.5 py-2 bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Plus size={14} />
              <span>Crear campaña</span>
            </button>
          </div>

          {campanas.length === 0 ? (
            <div className="bg-cd border border-[var(--bd)] rounded-xl p-12 text-center space-y-3">
              <div className="w-10 h-10 rounded-lg bg-sf border border-[var(--bd)] tx-mu mx-auto flex items-center justify-center">
                <Zap size={18} />
              </div>
              <h3 className="font-semibold text-sm">Aún no has creado ofertas flash</h3>
              <p className="text-xs tx-mu max-w-md mx-auto">
                Crea tu primera campaña basada en historial de compra para reactivar ventas sin pauta adicional.
              </p>
              <button
                type="button"
                onClick={() => handleAbrirCrearCampana()}
                className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] font-semibold rounded-lg text-xs inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Zap size={13} />
                <span>Crear primera oferta flash</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {campanas.map(camp => {
                const destinatarios = perfiles.filter(p => 
                  (camp.categoriaId === 'todas_vip' ? p.segmentoRFM === 'vip_campeon' : p.categoriaPrincipal === camp.categoriaId) &&
                  !p.enListaNegra &&
                  p.pedidosEntregados >= 1
                );

                const enviadosCount = camp.destinatariosEnviados.length;
                const porcentaje = destinatarios.length > 0 ? (enviadosCount / destinatarios.length) * 100 : 0;

                return (
                  <div key={camp.id} className="bg-cd border border-[var(--bd)] rounded-xl p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[var(--bd)] pb-3.5">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-sm text-[var(--tx)]">{camp.titulo}</h3>
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-sf border border-[var(--bd)] text-emerald-600 dark:text-emerald-400 font-semibold">
                            {camp.cuponCodigo}
                          </span>
                        </div>
                        <p className="text-xs tx-mu mt-0.5">
                          Cohorte: <strong className="text-[var(--tx)]">{camp.categoriaNombre}</strong> ·{' '}
                          {new Date(camp.fechaCreacion).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                        </p>
                      </div>

                      <div className="text-left sm:text-right shrink-0">
                        <span className="text-[11px] tx-mu block">Progreso de despacho</span>
                        <span className="text-xs font-mono tabular-nums font-semibold text-[var(--tx)]">
                          {enviadosCount} / {destinatarios.length} ({porcentaje.toFixed(0)}%)
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-sf p-3.5 rounded-lg border border-[var(--bd)] text-xs">
                      <div>
                        <span className="text-[11px] tx-mu block">Producto ofertado</span>
                        <span className="font-semibold text-[var(--tx)] block mt-0.5">{camp.productoOfertado}</span>
                      </div>
                      <div>
                        <span className="text-[11px] tx-mu block">Precio regular vs flash</span>
                        <div className="font-mono tabular-nums mt-0.5">
                          <span className="line-through tx-mu mr-2">${camp.precioRegular.toFixed(2)}</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                            ${camp.precioFlash.toFixed(2)} USD
                          </span>
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 ml-1.5">
                            (-${(camp.precioRegular - camp.precioFlash).toFixed(2)})
                          </span>
                        </div>
                      </div>
                      <div>
                        <span className="text-[11px] tx-mu block">Beneficio y vigencia</span>
                        <span className="font-medium text-[var(--tx)] block truncate mt-0.5">
                          {camp.beneficioExtra} · {camp.vigenciaHoras}h
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium tx-mu">
                          Clientes calificados ({destinatarios.length})
                        </span>
                        <span className="text-[11px] tx-mu hidden sm:inline">
                          Abre WhatsApp con el mensaje personalizado
                        </span>
                      </div>

                      <div className="max-h-56 overflow-y-auto border border-[var(--bd)] rounded-lg divide-y divide-[var(--bd)]">
                        {destinatarios.map(d => {
                          const yaEnviado = camp.destinatariosEnviados.includes(d.telefono);

                          const handleEnviarDestinatario = () => {
                            const msg = generarMensajeOfertaFlash({
                              nombreCliente: d.nombre,
                              productoOfertado: camp.productoOfertado,
                              productoAnterior: d.productosComprados[0]?.nombre,
                              precioRegular: camp.precioRegular,
                              precioFlash: camp.precioFlash,
                              cuponCodigo: camp.cuponCodigo,
                              vigenciaHoras: camp.vigenciaHoras,
                              beneficioExtra: camp.beneficioExtra,
                              pitchPersonalizado: camp.mensajePlantilla
                            });

                            marcarDestinatarioEnviado(camp.id, d.telefono);
                            const encoded = encodeURIComponent(msg);
                            window.open(`https://wa.me/503${d.telefono}?text=${encoded}`, '_blank');
                          };

                          return (
                            <div 
                              key={d.telefono} 
                              className="px-3 py-2.5 flex items-center justify-between gap-2 text-xs hover:bg-sf/60 transition-colors"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${yaEnviado ? 'bg-emerald-500' : 'bg-[var(--mu)]/40'}`} />
                                <div className="min-w-0">
                                  <span className="font-semibold text-[var(--tx)] block truncate">{d.nombre}</span>
                                  <span className="font-mono tabular-nums text-[11px] tx-mu">
                                    {d.telefonoDisplay} · Hace {d.diasDesdeUltimoPedido}d · LTV ${d.ltvTotal.toFixed(2)}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {yaEnviado && (
                                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium hidden sm:inline-flex items-center gap-1">
                                    <Check size={12} /> Enviado
                                  </span>
                                )}

                                <button
                                  type="button"
                                  onClick={handleEnviarDestinatario}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                                    yaEnviado
                                      ? 'border border-[var(--bd)] bg-cd tx-mu hover:text-[var(--tx)]'
                                      : 'bg-[var(--tx)] text-[var(--cd)] hover:opacity-90'
                                  }`}
                                >
                                  <MessageCircle size={12} />
                                  <span>{yaEnviado ? 'Reenviar' : 'Enviar WhatsApp'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DIRECTORIO DE CLIENTES & SCORE RFM */}
      {activeTab === 'directorio' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 tx-mu pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar cliente por nombre o teléfono..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-cd border border-[var(--bd)] rounded-lg text-xs outline-none focus:border-[var(--tx)]"
              />
            </div>

            <div className="flex items-center gap-1 bg-cd border border-[var(--bd)] rounded-lg p-1 overflow-x-auto">
              {[
                { k: 'todos', l: `Todos (${perfiles.length})` },
                { k: 'vip', l: `VIP (${perfiles.filter(p => p.segmentoRFM === 'vip_campeon').length})` },
                { k: 'fiel', l: `Fieles (${perfiles.filter(p => p.segmentoRFM === 'comprador_fiel').length})` },
                { k: 'listo', l: `Cross-Sell (${perfiles.filter(p => p.segmentoRFM === 'listo_cross_sell').length})` },
                { k: 'riesgo', l: `En riesgo (${perfiles.filter(p => p.segmentoRFM === 'en_riesgo').length})` },
                { k: 'bloqueado', l: `Excluidos (${perfiles.filter(p => p.enListaNegra || p.segmentoRFM === 'bloqueado').length})` },
              ].map((seg) => (
                <button
                  key={seg.k}
                  type="button"
                  onClick={() => setFiltroSegmento(seg.k)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    filtroSegmento === seg.k
                      ? 'bg-[var(--tx)] text-[var(--cd)] font-semibold'
                      : 'tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  {seg.l}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--bd)] bg-sf text-[11px] font-medium tx-mu">
                    <th className="py-2.5 px-4">Cliente</th>
                    <th className="py-2.5 px-4">Segmento RFM</th>
                    <th className="py-2.5 px-4 text-center">Entregados / Canc.</th>
                    <th className="py-2.5 px-4 text-right">LTV total</th>
                    <th className="py-2.5 px-4">Última compra</th>
                    <th className="py-2.5 px-4">Próxima necesidad</th>
                    <th className="py-2.5 px-4 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--bd)]">
                  {perfilesFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center tx-mu">
                        No se encontraron clientes con los filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    perfilesFiltrados.slice(0, 50).map(perfil => {
                      const renderSeg = () => {
                        switch (perfil.segmentoRFM) {
                          case 'vip_campeon':
                            return <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">VIP campeón</span>;
                          case 'comprador_fiel':
                            return <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Fiel ({perfil.pedidosEntregados})</span>;
                          case 'listo_cross_sell':
                            return <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">Listo oferta</span>;
                          case 'en_riesgo':
                            return <span className="text-[11px] font-semibold text-orange-600 dark:text-orange-400">En riesgo ({perfil.diasDesdeUltimoPedido}d)</span>;
                          case 'bloqueado':
                            return <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">Excluido fraude</span>;
                          default:
                            return <span className="text-[11px] tx-mu">Nuevo reciente</span>;
                        }
                      };

                      return (
                        <tr key={perfil.telefono} className="hover:bg-sf/50 transition-colors">
                          <td className="py-3 px-4">
                            <span className="font-semibold text-[var(--tx)] block">{perfil.nombre}</span>
                            <span className="font-mono tabular-nums text-[11px] tx-mu block">{perfil.telefonoDisplay}</span>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">{renderSeg()}</td>

                          <td className="py-3 px-4 text-center font-mono tabular-nums">
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{perfil.pedidosEntregados}</span>
                            <span className="tx-mu mx-1">/</span>
                            <span className={perfil.pedidosCancelados > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'tx-mu'}>
                              {perfil.pedidosCancelados}
                            </span>
                            <span className="text-[10px] tx-mu block">
                              {perfil.tasaEntrega.toFixed(0)}% efectividad
                            </span>
                          </td>

                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                            ${perfil.ltvTotal.toFixed(2)}
                            <span className="text-[10px] tx-mu block font-normal">
                              Ticket ${perfil.ticketPromedio.toFixed(2)}
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            <span className="font-medium text-[var(--tx)] block tabular-nums">
                              Hace {perfil.diasDesdeUltimoPedido} días
                            </span>
                            <span className="text-[11px] tx-mu block truncate max-w-[200px]">
                              {perfil.productosComprados[0]?.nombre || 'Sin producto'}
                            </span>
                          </td>

                          <td className="py-3 px-4">
                            {perfil.proximaNecesidadEstimada ? (
                              <div>
                                <span className="font-medium text-[var(--tx)] text-xs block">
                                  {perfil.proximaNecesidadEstimada.productoRecomendado}
                                </span>
                                <span className="text-[11px] tx-mu block font-mono tabular-nums">
                                  Flash ${perfil.proximaNecesidadEstimada.precioFlash.toFixed(2)} (Reg ${perfil.proximaNecesidadEstimada.precioRegular.toFixed(2)})
                                </span>
                              </div>
                            ) : (
                              <span className="text-[11px] tx-mu">Sin ciclo</span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right">
                            {perfil.enListaNegra ? (
                              <span className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">Bloqueado</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleEnviarIndividual(perfil)}
                                className="px-2.5 py-1.5 border border-[var(--bd)] bg-sf hover:border-[var(--tx)] text-[var(--tx)] font-medium rounded-lg text-xs inline-flex items-center gap-1 transition-colors cursor-pointer"
                              >
                                <MessageCircle size={12} />
                                <span>Ofertar</span>
                              </button>
                            )}
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

      {/* TAB 4: BOT DE SEGUIMIENTO LOGÍSTICO & REGLAS */}
      {activeTab === 'bot' && (
        <div className="flex flex-col gap-5">
          <div className="bg-cd p-5 rounded-xl border border-[var(--bd)] space-y-1.5">
            <h2 className="text-sm font-semibold text-[var(--tx)]">
              Arquitectura del Bot Logístico &amp; Fidelización
            </h2>
            <p className="text-xs tx-mu leading-relaxed max-w-3xl">
              A diferencia del bot de ventas en UniChat que atiende leads iniciales, este flujo acompaña al cliente después de la entrega, protege la línea de WhatsApp y reactiva recompras en su ventana óptima.
            </p>
          </div>

          <div className="bg-cd border border-[var(--bd)] rounded-xl grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--bd)] overflow-hidden">
            <div className="p-5 space-y-2.5">
              <div className="text-xs font-mono tx-mu">01 · Día 0–2</div>
              <h3 className="font-semibold text-sm text-[var(--tx)]">Confirmación &amp; Satisfacción</h3>
              <p className="text-xs tx-mu leading-relaxed">
                Se activa con el evento <code className="font-mono">order.delivered</code>. Agradece la compra, comparte guía de uso y valida la entrega.
              </p>
              <div className="p-2.5 bg-sf rounded-lg border border-[var(--bd)] text-[11px] font-mono tx-mu">
                Trigger: order.delivered
              </div>
            </div>

            <div className="p-5 space-y-2.5">
              <div className="text-xs font-mono tx-mu">02 · Día 30–90</div>
              <h3 className="font-semibold text-sm text-[var(--tx)]">Maduración del Ciclo</h3>
              <p className="text-xs tx-mu leading-relaxed">
                Monitorea la categoría comprada y calcula la ventana de recompra respetando límites anti-saturación y Lista Negra.
              </p>
              <div className="p-2.5 bg-sf rounded-lg border border-[var(--bd)] text-[11px] font-mono tx-mu">
                Regla: Máx. 1 oferta / 30d · Filtro DICOM
              </div>
            </div>

            <div className="p-5 space-y-2.5">
              <div className="text-xs font-mono tx-mu">03 · Conversión</div>
              <h3 className="font-semibold text-sm text-[var(--tx)]">Oferta Flash COD</h3>
              <p className="text-xs tx-mu leading-relaxed">
                Envía invitación privada con cupón único y pago contra entrega en puerta, sin costo de adquisición adicional.
              </p>
              <div className="p-2.5 bg-sf rounded-lg border border-[var(--bd)] text-[11px] font-mono tx-mu">
                Conv. est. 12%–18% · CAC $0.00
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------- MODAL NUEVA OFERTA FLASH --------------------------- */}
      {modalNuevaCampana && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-cd border border-[var(--bd)] rounded-xl max-w-2xl w-full p-5 sm:p-6 space-y-4 shadow-2xl relative my-auto">
            <div className="flex items-start justify-between border-b border-[var(--bd)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--tx)]">
                  Nueva Oferta Flash (Venta Privada B2C)
                </h3>
                <p className="text-xs tx-mu mt-0.5">
                  Configura producto, precios y plantilla personalizada para el cohorte.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setModalNuevaCampana(false)}
                className="p-1.5 rounded-lg bg-sf border border-[var(--bd)] tx-mu hover:text-[var(--tx)] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {formError && (
              <div className="px-3 py-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleGuardarNuevaCampana} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium tx-mu block mb-1">
                    Cohorte de destinatarios *
                  </label>
                  <select
                    value={catSeleccionadaId}
                    onChange={e => {
                      const id = e.target.value;
                      setCatSeleccionadaId(id);
                      const cat = CATEGORIAS_CROSS_SELL.find(c => c.id === id);
                      if (cat) {
                        setProductoOfertado(cat.productoRecomendadoDefault);
                        setPrecioRegular(cat.precioRegularDefault.toFixed(2));
                        setPrecioFlash(cat.precioFlashDefault.toFixed(2));
                        setPitchPersonalizado(cat.pitchCrossSell);
                        setCuponCodigo(`VIP-${cat.id.slice(0, 4).toUpperCase()}${new Date().getFullYear() % 100}`);
                      }
                    }}
                    className="w-full p-2.5 bg-sf border border-[var(--bd)] rounded-lg font-medium outline-none focus:border-[var(--tx)]"
                  >
                    {CATEGORIAS_CROSS_SELL.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.nombre} ({cohortes.find(x => x.id === c.id)?.totalClientes || 0} clientes)
                      </option>
                    ))}
                    <option value="todas_vip">Todos los Clientes VIP Campeones ({metricas.clientesVip})</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-medium tx-mu block mb-1">
                    Título de la campaña *
                  </label>
                  <input
                    type="text"
                    value={tituloCampana}
                    onChange={e => setTituloCampana(e.target.value)}
                    placeholder="Ej. Oferta Flash: Primeros Pasos Bebé"
                    required
                    className="w-full p-2.5 bg-sf border border-[var(--bd)] rounded-lg font-medium outline-none focus:border-[var(--tx)]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium tx-mu block mb-1">
                  Producto a ofertar (Cross-Sell) *
                </label>
                <input
                  type="text"
                  value={productoOfertado}
                  onChange={e => setProductoOfertado(e.target.value)}
                  placeholder="Ej. Asistente de Caminado + Gorro Anticaídas"
                  required
                  className="w-full p-2.5 bg-sf border border-[var(--bd)] rounded-lg font-semibold outline-none focus:border-[var(--tx)] text-sm"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-medium tx-mu block mb-1">
                    Precio regular ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={precioRegular}
                    onChange={e => setPrecioRegular(e.target.value)}
                    className="w-full p-2 bg-sf border border-[var(--bd)] rounded-lg font-mono tabular-nums text-xs outline-none focus:border-[var(--tx)]"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 block mb-1">
                    Precio flash VIP ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={precioFlash}
                    onChange={e => setPrecioFlash(e.target.value)}
                    required
                    className="w-full p-2 bg-sf border border-emerald-500/40 rounded-lg font-mono tabular-nums text-xs font-semibold outline-none focus:border-emerald-500 text-emerald-600 dark:text-emerald-400"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium tx-mu block mb-1">
                    Código cupón
                  </label>
                  <input
                    type="text"
                    value={cuponCodigo}
                    onChange={e => setCuponCodigo(e.target.value)}
                    className="w-full p-2 bg-sf border border-[var(--bd)] rounded-lg font-mono text-xs font-semibold uppercase outline-none focus:border-[var(--tx)]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium tx-mu block mb-1">
                  Pitch de venta / Razón de necesidad futura
                </label>
                <textarea
                  rows={2}
                  value={pitchPersonalizado}
                  onChange={e => setPitchPersonalizado(e.target.value)}
                  placeholder="Ej. Tu bebé ya está en la etapa de dar sus primeros pasos..."
                  className="w-full p-2.5 bg-sf border border-[var(--bd)] rounded-lg outline-none focus:border-[var(--tx)] resize-none text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium tx-mu flex items-center gap-1">
                    <MessageCircle size={12} className="text-emerald-500" />
                    Vista previa del mensaje
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(mensajePreviewCampana);
                      setCopiadoPreview(true);
                      setTimeout(() => setCopiadoPreview(false), 2000);
                    }}
                    className="text-[11px] font-medium tx-mu hover:text-[var(--tx)] inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiadoPreview ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                    <span>{copiadoPreview ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>

                <div className="p-3.5 bg-sf border border-[var(--bd)] rounded-lg text-xs text-[var(--tx)] whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto select-text">
                  {mensajePreviewCampana}
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--bd)] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalNuevaCampana(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-lg text-xs font-medium hover:bg-sf cursor-pointer"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 font-semibold rounded-lg text-xs inline-flex items-center gap-1.5 transition-opacity cursor-pointer"
                >
                  <Zap size={13} />
                  <span>Crear campaña flash</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function RepeatIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function TargetIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
