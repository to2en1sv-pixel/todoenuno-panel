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

  const handleGuardarNuevaCampana = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productoOfertado.trim()) {
      alert('Por favor ingresa el producto ofertado.');
      return;
    }

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
  const renderIconoCat = (catId: string, size = 18) => {
    switch (catId) {
      case 'maternidad_bebes': return <Baby size={size} className="text-pink-500" />;
      case 'hogar_cocina': return <UtensilsCrossed size={size} className="text-amber-500" />;
      case 'belleza_cuidado': return <Sparkles size={size} className="text-purple-500" />;
      case 'tecnologia_gadgets': return <Smartphone size={size} className="text-blue-500" />;
      case 'herramientas_auto': return <Wrench size={size} className="text-orange-500" />;
      case 'fitness_salud': return <HeartPulse size={size} className="text-emerald-500" />;
      default: return <Package size={size} className="text-indigo-500" />;
    }
  };

  return (
    <div className="min-h-screen bg-[var(--cd)] text-[var(--tx)] p-4 md:p-6 flex flex-col relative pb-28">
      {/* --------------------------- HEADER PRINCIPAL --------------------------- */}
      <header className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-4 mb-6">
        <div className="shrink-0 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-black tracking-tight whitespace-normal sm:whitespace-nowrap">
              Fidelización & LTV Predictivo
            </h1>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 border border-indigo-500/20 shrink-0">
              COD Retention Engine
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 shrink-0">
              Cross-Sell B2C
            </span>
          </div>
          <p className="text-xs md:text-sm tx-mu mt-0.5 max-w-2xl">
            Agrupación de clientes por ciclo de necesidad futura, cálculo de Customer Lifetime Value y ofertas flash masivas vía WhatsApp.
          </p>
        </div>

        {/* Acciones Superiores */}
        <div className="flex flex-wrap items-center gap-2 2xl:justify-end">
          <button
            onClick={() => cargarOrdenes(true)}
            disabled={refreshing}
            className="p-2.5 rounded-xl border border-[var(--bd)] bg-cd hover:bg-sf transition-colors shrink-0"
            title="Recargar datos de pedidos"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => handleAbrirCrearCampana()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 px-4 py-2 text-xs font-bold text-white shadow-md transition-all whitespace-nowrap"
          >
            <Zap size={14} className="fill-white" />
            <span>+ Nueva Oferta Flash</span>
          </button>
        </div>
      </header>

      {/* --------------------------- KPI METRICS BAR --------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
        <div className="p-3.5 rounded-2xl bg-sf border border-[var(--bd)] space-y-1">
          <div className="flex items-center justify-between tx-mu">
            <span className="text-[10px] uppercase font-bold">Clientes Únicos</span>
            <Users size={14} className="text-indigo-500" />
          </div>
          <div className="text-lg lg:text-xl font-black font-mono">
            {metricas.totalClientesUnicos}
          </div>
          <p className="text-[10px] tx-mu">Base activa con compras</p>
        </div>

        <div className="p-3.5 rounded-2xl bg-sf border border-[var(--bd)] space-y-1">
          <div className="flex items-center justify-between tx-mu">
            <span className="text-[10px] uppercase font-bold">Tasa Recompra</span>
            <RepeatIcon size={14} className="text-emerald-500" />
          </div>
          <div className="text-lg lg:text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
            {metricas.tasaRecompra.toFixed(1)}%
          </div>
          <p className="text-[10px] tx-mu">{metricas.clientesConRecompra} clientes recurrentes</p>
        </div>

        <div className="p-3.5 rounded-2xl bg-sf border border-[var(--bd)] space-y-1">
          <div className="flex items-center justify-between tx-mu">
            <span className="text-[10px] uppercase font-bold">LTV Promedio</span>
            <DollarSign size={14} className="text-blue-500" />
          </div>
          <div className="text-lg lg:text-xl font-black font-mono">
            ${metricas.ltvPromedio.toFixed(2)}
          </div>
          <p className="text-[10px] tx-mu">Ticket: ${metricas.ticketPromedioGeneral.toFixed(2)}</p>
        </div>

        <div className="p-3.5 rounded-2xl bg-sf border border-amber-500/20 bg-amber-500/5 space-y-1">
          <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
            <span className="text-[10px] uppercase font-bold">Listos Oferta Flash</span>
            <Flame size={14} className="text-amber-500 animate-bounce" />
          </div>
          <div className="text-lg lg:text-xl font-black font-mono text-amber-600 dark:text-amber-400">
            {metricas.clientesListosOferta}
          </div>
          <p className="text-[10px] tx-mu">En ventana de maduración</p>
        </div>

        <div className="p-3.5 rounded-2xl bg-sf border border-[var(--bd)] space-y-1">
          <div className="flex items-center justify-between tx-mu">
            <span className="text-[10px] uppercase font-bold">Clientes VIP</span>
            <Sparkles size={14} className="text-yellow-500" />
          </div>
          <div className="text-lg lg:text-xl font-black font-mono text-yellow-600 dark:text-yellow-400">
            {metricas.clientesVip}
          </div>
          <p className="text-[10px] tx-mu">2+ pedidos · Alto valor</p>
        </div>

        <div className="p-3.5 rounded-2xl bg-sf border border-rose-500/20 bg-rose-500/5 space-y-1">
          <div className="flex items-center justify-between text-rose-500">
            <span className="text-[10px] uppercase font-bold">Excluidos DICOM</span>
            <ShieldAlert size={14} />
          </div>
          <div className="text-lg lg:text-xl font-black font-mono text-rose-600 dark:text-rose-400">
            {metricas.clientesExcluidosFraude}
          </div>
          <p className="text-[10px] tx-mu">0% gasto en ofertas a canceladores</p>
        </div>
      </div>

      {/* --------------------------- TABS DE NAVEGACIÓN --------------------------- */}
      <div className="flex items-center gap-1 border-b border-[var(--bd)] pb-3 mb-5 overflow-x-auto">
        <button
          onClick={() => setActiveTab('cohortes')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'cohortes'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-[var(--tx)] hover:bg-sf tx-mu'
          }`}
        >
          <TargetIcon size={14} />
          <span>🎯 Cohortes & Cross-Sell Predictivo</span>
        </button>

        <button
          onClick={() => setActiveTab('campanas')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'campanas'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-[var(--tx)] hover:bg-sf tx-mu'
          }`}
        >
          <Zap size={14} />
          <span>⚡ Campañas Ofertas Flash ({campanas.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('directorio')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'directorio'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-[var(--tx)] hover:bg-sf tx-mu'
          }`}
        >
          <Users size={14} />
          <span>👥 Directorio Clientes & RFM ({perfiles.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('bot')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'bot'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-[var(--tx)] hover:bg-sf tx-mu'
          }`}
        >
          <Bot size={14} />
          <span>🤖 Bot Logístico & Fidelización</span>
        </button>
      </div>

      {/* --------------------------- CONTENIDO DE TABS --------------------------- */}

      {/* TAB 1: COHORTES & CROSS-SELL PREDICTIVO */}
      {activeTab === 'cohortes' && (
        <div className="space-y-6">
          <div className="bg-sf p-4 rounded-2xl border border-[var(--bd)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black flex items-center gap-2">
                <span>Inteligencia de Necesidad Futura por Ciclo de Vida</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  Potencial: ~${metricas.potencialVentasCrossSell.toFixed(0)} USD
                </span>
              </h2>
              <p className="text-xs tx-mu mt-0.5">
                Detecta clientes que compraron productos de una categoría específica y calcula el momento exacto en que necesitarán el siguiente producto (ej. Portabebé ➔ Asistente de caminado a los 3-6 meses).
              </p>
            </div>
            <button
              onClick={() => handleAbrirCrearCampana()}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shrink-0 shadow-sm"
            >
              <Zap size={13} />
              <span>Crear Oferta Flash Personalizada</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cohortes.map(cohorte => (
              <div 
                key={cohorte.id} 
                className="bg-cd border border-[var(--bd)] rounded-2xl p-5 flex flex-col justify-between hover:border-indigo-500/40 transition-all shadow-sm relative overflow-hidden group"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-sf border border-[var(--bd)] flex items-center justify-center shrink-0">
                        {renderIconoCat(cohorte.id, 20)}
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-[var(--tx)] leading-tight">{cohorte.nombre}</h3>
                        <span className="text-[10px] tx-mu">Ventana óptima: {cohorte.diasMaduracion} días</span>
                      </div>
                    </div>

                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      cohorte.clientesMaduros > 0 
                        ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20 font-mono' 
                        : 'bg-sf text-slate-400'
                    }`}>
                      {cohorte.clientesMaduros} listos
                    </span>
                  </div>

                  <p className="text-xs tx-mu leading-relaxed">
                    {cohorte.descripcion}
                  </p>

                  <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                        <ShoppingBag size={12} /> Siguiente Producto:
                      </span>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        ${cohorte.precioFlashDefault.toFixed(2)} <span className="line-through text-[10px] tx-mu">${cohorte.precioRegularDefault.toFixed(2)}</span>
                      </span>
                    </div>
                    <div className="font-semibold text-xs text-[var(--tx)]">
                      {cohorte.productoRecomendadoDefault}
                    </div>
                    <p className="text-[10px] tx-mu italic leading-tight">
                      "{cohorte.pitchCrossSell}"
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-[var(--bd)] mt-4 flex items-center justify-between gap-2">
                  <div className="text-[10px] tx-mu">
                    <strong>{cohorte.totalClientes}</strong> clientes en cohorte
                  </div>

                  <button
                    onClick={() => handleAbrirCrearCampana(cohorte)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                  >
                    <Zap size={12} />
                    <span>Lanzar Oferta Flash</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: CAMPAÑAS DE OFERTAS FLASH (ESTILO LICITACIONES MASIVAS) */}
      {activeTab === 'campanas' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-sf p-4 rounded-2xl border border-[var(--bd)]">
            <div>
              <h2 className="text-sm font-black flex items-center gap-2">
                <span>Historial de Campañas & Licitaciones Flash B2C</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
                  {campanas.length} creadas
                </span>
              </h2>
              <p className="text-xs tx-mu mt-0.5">
                Envía ofertas exclusivas por WhatsApp con temporizador de 48h a grupos segmentados, igual que las licitaciones a almacenes pero dirigido a clientes VIP.
              </p>
            </div>

            <button
              onClick={() => handleAbrirCrearCampana()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shrink-0 shadow-md transition-all"
            >
              <Plus size={14} />
              <span>Crear Nueva Campaña</span>
            </button>
          </div>

          {campanas.length === 0 ? (
            <div className="bg-cd border border-[var(--bd)] rounded-2xl p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-600 mx-auto flex items-center justify-center">
                <Zap size={24} />
              </div>
              <h3 className="font-bold text-base">Aún no has creado ofertas flash</h3>
              <p className="text-xs tx-mu max-w-md mx-auto">
                Crea tu primera campaña basada en lo que compraron tus clientes (ej. portabebés, gadgets o cocina) para reactivar ventas sin costo publicitario en Meta.
              </p>
              <button
                onClick={() => handleAbrirCrearCampana()}
                className="px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-xs inline-flex items-center gap-1.5 shadow-md"
              >
                <Zap size={14} />
                <span>Crear mi primera Oferta Flash</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {campanas.map(camp => {
                // Obtener clientes destinatarios de esta campaña
                const destinatarios = perfiles.filter(p => 
                  (camp.categoriaId === 'todas_vip' ? p.segmentoRFM === 'vip_campeon' : p.categoriaPrincipal === camp.categoriaId) &&
                  !p.enListaNegra &&
                  p.pedidosEntregados >= 1
                );

                const enviadosCount = camp.destinatariosEnviados.length;
                const porcentaje = destinatarios.length > 0 ? (enviadosCount / destinatarios.length) * 100 : 0;

                return (
                  <div key={camp.id} className="bg-cd border border-[var(--bd)] rounded-2xl p-5 space-y-4 shadow-sm">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[var(--bd)] pb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
                          <Flame size={20} className="text-amber-500" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-black text-sm text-[var(--tx)]">{camp.titulo}</h3>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 uppercase font-mono">
                              Cupón: {camp.cuponCodigo}
                            </span>
                          </div>
                          <p className="text-xs tx-mu mt-0.5">
                            Cohorte: <strong>{camp.categoriaNombre}</strong> · Creada el {new Date(camp.fechaCreacion).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="text-right">
                          <span className="text-[10px] tx-mu block uppercase font-bold">Progreso de Despacho</span>
                          <span className="text-xs font-mono font-bold">
                            {enviadosCount} / {destinatarios.length} ({porcentaje.toFixed(0)}%)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Resumen del Producto y Precios */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-sf p-3.5 rounded-xl border border-[var(--bd)] text-xs">
                      <div>
                        <span className="text-[10px] uppercase font-bold tx-mu block">Producto Ofertado</span>
                        <span className="font-bold text-[var(--tx)] block">{camp.productoOfertado}</span>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold tx-mu block">Precio Regular vs Flash</span>
                        <div className="font-mono">
                          <span className="line-through text-slate-400 mr-2">${camp.precioRegular.toFixed(2)}</span>
                          <span className="font-black text-emerald-600 dark:text-emerald-400 text-sm">
                            ${camp.precioFlash.toFixed(2)} USD
                          </span>
                          <span className="text-[10px] text-emerald-500 ml-1.5 font-bold">
                            (Ahorro ${(camp.precioRegular - camp.precioFlash).toFixed(2)})
                          </span>
                        </div>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold tx-mu block">Beneficio & Vigencia</span>
                        <span className="font-semibold text-[var(--tx)] block truncate">
                          {camp.beneficioExtra} · {camp.vigenciaHoras}h
                        </span>
                      </div>
                    </div>

                    {/* Destinatarios de la Campaña con Botón de WhatsApp Directo */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold tx-mu text-[11px] uppercase">
                          Clientes Calificados en este Cohorte ({destinatarios.length}):
                        </span>
                        <span className="text-[10px] tx-mu">
                          Haz clic en «Enviar WhatsApp» para abrir el chat personalizado
                        </span>
                      </div>

                      <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
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
                              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs transition-colors ${
                                yaEnviado 
                                  ? 'bg-emerald-500/5 border-emerald-500/20' 
                                  : 'bg-sf border-[var(--bd)] hover:bg-cd'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`w-2 h-2 rounded-full shrink-0 ${yaEnviado ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
                                <div className="min-w-0">
                                  <span className="font-bold text-[var(--tx)] block truncate">{d.nombre}</span>
                                  <span className="font-mono text-[11px] tx-mu">
                                    {d.telefonoDisplay} · Compró hace {d.diasDesdeUltimoPedido}d · LTV: ${d.ltvTotal.toFixed(2)}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {yaEnviado && (
                                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 hidden sm:flex">
                                    <Check size={12} /> Enviado
                                  </span>
                                )}

                                <button
                                  onClick={handleEnviarDestinatario}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                                    yaEnviado
                                      ? 'border border-[var(--bd)] text-slate-500 hover:bg-sf'
                                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                                  }`}
                                >
                                  <MessageCircle size={13} />
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
        <div className="space-y-4">
          {/* Barra de Filtros */}
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 tx-mu" />
              <input
                type="text"
                placeholder="Buscar cliente por nombre o teléfono..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-sf border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setFiltroSegmento('todos')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  filtroSegmento === 'todos' ? 'bg-indigo-600 text-white' : 'bg-sf border border-[var(--bd)] tx-mu'
                }`}
              >
                Todos ({perfiles.length})
              </button>
              <button
                onClick={() => setFiltroSegmento('vip')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  filtroSegmento === 'vip' ? 'bg-yellow-500 text-black' : 'bg-sf border border-[var(--bd)] tx-mu'
                }`}
              >
                ⭐ VIP Campeón ({perfiles.filter(p => p.segmentoRFM === 'vip_campeon').length})
              </button>
              <button
                onClick={() => setFiltroSegmento('fiel')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  filtroSegmento === 'fiel' ? 'bg-emerald-600 text-white' : 'bg-sf border border-[var(--bd)] tx-mu'
                }`}
              >
                💎 Fiel Recompra ({perfiles.filter(p => p.segmentoRFM === 'comprador_fiel').length})
              </button>
              <button
                onClick={() => setFiltroSegmento('listo')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  filtroSegmento === 'listo' ? 'bg-amber-600 text-white' : 'bg-sf border border-[var(--bd)] tx-mu'
                }`}
              >
                🎯 Listo Cross-Sell ({perfiles.filter(p => p.segmentoRFM === 'listo_cross_sell').length})
              </button>
              <button
                onClick={() => setFiltroSegmento('riesgo')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  filtroSegmento === 'riesgo' ? 'bg-orange-600 text-white' : 'bg-sf border border-[var(--bd)] tx-mu'
                }`}
              >
                💤 En Riesgo ({perfiles.filter(p => p.segmentoRFM === 'en_riesgo').length})
              </button>
              <button
                onClick={() => setFiltroSegmento('bloqueado')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  filtroSegmento === 'bloqueado' ? 'bg-rose-600 text-white' : 'bg-sf border border-[var(--bd)] tx-mu'
                }`}
              >
                🛡️ Excluidos ({perfiles.filter(p => p.enListaNegra || p.segmentoRFM === 'bloqueado').length})
              </button>
            </div>
          </div>

          {/* Tabla de Clientes */}
          <div className="bg-cd border border-[var(--bd)] rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--bd)] bg-sf/60 text-[10px] uppercase font-bold tx-mu">
                    <th className="p-3.5">Cliente</th>
                    <th className="p-3.5">Segmento RFM</th>
                    <th className="p-3.5 text-center">Entregados / Canc.</th>
                    <th className="p-3.5 text-right">LTV Total</th>
                    <th className="p-3.5">Última Compra</th>
                    <th className="p-3.5">Próxima Necesidad (Cross-Sell)</th>
                    <th className="p-3.5 text-right">Acción</th>
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
                      const badgeRFM = () => {
                        switch (perfil.segmentoRFM) {
                          case 'vip_campeon':
                            return <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-yellow-500/10 text-yellow-600 border border-yellow-500/20">⭐ VIP CAMPEÓN</span>;
                          case 'comprador_fiel':
                            return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">💎 FIEL ({perfil.pedidosEntregados} entr.)</span>;
                          case 'listo_cross_sell':
                            return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">🎯 LISTO OFERTA</span>;
                          case 'en_riesgo':
                            return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/10 text-orange-600 border border-orange-500/20">💤 EN RIESGO ({perfil.diasDesdeUltimoPedido}d)</span>;
                          case 'bloqueado':
                            return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20">🚨 EXCLUIDO FRAUDE</span>;
                          default:
                            return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-sf tx-mu">NUEVO RECIENTE</span>;
                        }
                      };

                      return (
                        <tr key={perfil.telefono} className="hover:bg-sf/50 transition-colors">
                          <td className="p-3.5">
                            <span className="font-bold text-[var(--tx)] block">{perfil.nombre}</span>
                            <span className="font-mono text-[11px] tx-mu block">{perfil.telefonoDisplay}</span>
                          </td>

                          <td className="p-3.5">
                            {badgeRFM()}
                          </td>

                          <td className="p-3.5 text-center font-mono">
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">{perfil.pedidosEntregados}</span>
                            <span className="tx-mu mx-1">/</span>
                            <span className={perfil.pedidosCancelados > 0 ? 'text-rose-500 font-bold' : 'tx-mu'}>
                              {perfil.pedidosCancelados}
                            </span>
                            <span className="text-[10px] tx-mu block">
                              {perfil.tasaEntrega.toFixed(0)}% efectividad
                            </span>
                          </td>

                          <td className="p-3.5 text-right font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                            ${perfil.ltvTotal.toFixed(2)}
                            <span className="text-[10px] tx-mu block font-normal">
                              Ticket: ${perfil.ticketPromedio.toFixed(2)}
                            </span>
                          </td>

                          <td className="p-3.5">
                            <span className="font-semibold text-[var(--tx)] block">
                              Hace {perfil.diasDesdeUltimoPedido} días
                            </span>
                            <span className="text-[10px] tx-mu block truncate max-w-xs">
                              {perfil.productosComprados[0]?.nombre || 'Sin producto registrado'}
                            </span>
                          </td>

                          <td className="p-3.5">
                            {perfil.proximaNecesidadEstimada ? (
                              <div>
                                <span className="font-bold text-indigo-600 dark:text-indigo-400 text-xs block">
                                  {perfil.proximaNecesidadEstimada.productoRecomendado}
                                </span>
                                <span className="text-[10px] tx-mu block font-mono">
                                  Oferta: ${perfil.proximaNecesidadEstimada.precioFlash.toFixed(2)} (Reg: ${perfil.proximaNecesidadEstimada.precioRegular.toFixed(2)})
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] tx-mu">Sin ciclo asignado</span>
                            )}
                          </td>

                          <td className="p-3.5 text-right">
                            {perfil.enListaNegra ? (
                              <span className="text-[10px] text-rose-500 font-bold">Bloqueado</span>
                            ) : (
                              <button
                                onClick={() => handleEnviarIndividual(perfil)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold rounded-xl text-xs inline-flex items-center gap-1 shadow-sm transition-all"
                                title="Enviar oferta personalizada por WhatsApp"
                              >
                                <MessageCircle size={13} />
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
        <div className="space-y-6">
          <div className="bg-sf p-5 rounded-2xl border border-[var(--bd)] space-y-2">
            <div className="flex items-center gap-2.5 text-indigo-600">
              <Bot size={22} />
              <h2 className="text-base font-black text-[var(--tx)]">
                Arquitectura del Bot Logístico & Fidelización
              </h2>
            </div>
            <p className="text-xs tx-mu leading-relaxed max-w-3xl">
              A diferencia del bot de ventas (UniChat) que atiende leads fríos y cierra pedidos iniciales, este <strong>Bot Asistente Logístico & Post-Venta</strong> se encarga exclusivamente de acompañar al cliente después de la entrega, proteger la reputación de tu línea de WhatsApp y reactivar recompras en el momento idóneo.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-cd border border-[var(--bd)] rounded-2xl p-5 space-y-3 relative">
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 font-black text-sm flex items-center justify-center">
                1
              </div>
              <h3 className="font-bold text-sm">Fase 1: Confirmación & Satisfacción (Día 0-2)</h3>
              <p className="text-xs tx-mu leading-relaxed">
                Se activa con el evento <code>order.delivered</code>. Envía mensaje agradeciendo la compra, compartiendo el manual o video de uso del producto, y confirmando que el paquete llegó en perfecto estado.
              </p>
              <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] text-[11px] font-mono text-slate-500">
                Trigger: OS Event <code>order.delivered</code><br />
                Objetivo: Evitar reclamos y afianzar confianza.
              </div>
            </div>

            <div className="bg-cd border border-[var(--bd)] rounded-2xl p-5 space-y-3 relative">
              <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 font-black text-sm flex items-center justify-center">
                2
              </div>
              <h3 className="font-bold text-sm">Fase 2: Maduración del Ciclo (Día 30-90)</h3>
              <p className="text-xs tx-mu leading-relaxed">
                El sistema monitorea la categoría comprada. Si compró portabebé, espera a los primeros pasos (90-180d); si compró cocina o belleza, espera a los 30-45d para proponer el complemento perfecto.
              </p>
              <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] text-[11px] font-mono text-slate-500">
                Regla: Anti-Saturación (Máx. 1 oferta cada 30 días)<br />
                Filtro: Exclusión estricta de Lista Negra.
              </div>
            </div>

            <div className="bg-cd border border-[var(--bd)] rounded-2xl p-5 space-y-3 relative">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 font-black text-sm flex items-center justify-center">
                3
              </div>
              <h3 className="font-bold text-sm">Fase 3: Oferta Flash con Despacho Inmediato</h3>
              <p className="text-xs tx-mu leading-relaxed">
                El cliente recibe una invitación a una venta privada con cupón único, descuento VIP y recordatorio de que paga contra entrega al recibir en su puerta sin adelantar dinero.
              </p>
              <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] text-[11px] font-mono text-slate-500">
                Conversión esperada: 12% - 18%<br />
                CAC (Costo de adquisición): $0.00 USD.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------- MODAL NUEVA OFERTA FLASH --------------------------- */}
      {modalNuevaCampana && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-cd border border-[var(--bd)] rounded-2xl max-w-2xl w-full p-5 sm:p-6 space-y-4 shadow-2xl relative my-auto animate-in fade-in">
            {/* Header Modal */}
            <div className="flex items-start justify-between border-b border-[var(--bd)] pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
                  <Flame size={22} />
                </div>
                <div>
                  <h3 className="text-base font-black text-[var(--tx)]">
                    Nueva Oferta Flash (Venta Privada B2C)
                  </h3>
                  <p className="text-xs tx-mu mt-0.5">
                    Configura el producto, precios y plantilla personalizada para tu cohorte.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setModalNuevaCampana(false)}
                className="p-1 rounded-lg hover:bg-sf text-slate-400 hover:text-[var(--tx)]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleGuardarNuevaCampana} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tx-mu block mb-1">
                    Cohorte de Destinatarios *
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
                    className="w-full p-2.5 bg-sf border border-[var(--bd)] rounded-xl font-semibold outline-none focus:border-indigo-500"
                  >
                    {CATEGORIAS_CROSS_SELL.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.nombre} ({cohortes.find(x => x.id === c.id)?.totalClientes || 0} clientes)
                      </option>
                    ))}
                    <option value="todas_vip">⭐ Todos los Clientes VIP Campeones ({metricas.clientesVip})</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tx-mu block mb-1">
                    Título de la Campaña *
                  </label>
                  <input
                    type="text"
                    value={tituloCampana}
                    onChange={e => setTituloCampana(e.target.value)}
                    placeholder="Ej. Oferta Flash: Primeros Pasos Bebé"
                    required
                    className="w-full p-2.5 bg-sf border border-[var(--bd)] rounded-xl font-semibold outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tx-mu block mb-1">
                  Producto a Ofertar (Cross-Sell) *
                </label>
                <input
                  type="text"
                  value={productoOfertado}
                  onChange={e => setProductoOfertado(e.target.value)}
                  placeholder="Ej. Asistente de Caminado + Gorro Anticaídas"
                  required
                  className="w-full p-2.5 bg-sf border border-[var(--bd)] rounded-xl font-bold outline-none focus:border-indigo-500 text-sm"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tx-mu block mb-1">
                    Precio Regular ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={precioRegular}
                    onChange={e => setPrecioRegular(e.target.value)}
                    className="w-full p-2 bg-sf border border-[var(--bd)] rounded-xl font-mono text-xs outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tx-mu block mb-1 text-emerald-600 dark:text-emerald-400">
                    Precio Flash VIP ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={precioFlash}
                    onChange={e => setPrecioFlash(e.target.value)}
                    required
                    className="w-full p-2 bg-sf border border-emerald-500/40 rounded-xl font-mono text-xs font-bold outline-none focus:border-emerald-500 text-emerald-600"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tx-mu block mb-1">
                    Código Cupón
                  </label>
                  <input
                    type="text"
                    value={cuponCodigo}
                    onChange={e => setCuponCodigo(e.target.value)}
                    className="w-full p-2 bg-sf border border-[var(--bd)] rounded-xl font-mono text-xs font-bold uppercase outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tx-mu block mb-1">
                  Pitch de Venta / Razón de Necesidad Futura
                </label>
                <textarea
                  rows={2}
                  value={pitchPersonalizado}
                  onChange={e => setPitchPersonalizado(e.target.value)}
                  placeholder="Ej. Tu bebé ya está en la etapa de dar sus primeros pasos..."
                  className="w-full p-2.5 bg-sf border border-[var(--bd)] rounded-xl outline-none focus:border-indigo-500 resize-none text-xs"
                />
              </div>

              {/* Vista Previa del Mensaje de WhatsApp */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tx-mu flex items-center gap-1">
                    <MessageCircle size={12} className="text-emerald-500" />
                    Vista Previa: Mensaje de WhatsApp
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(mensajePreviewCampana);
                      setCopiadoPreview(true);
                      setTimeout(() => setCopiadoPreview(false), 2000);
                    }}
                    className="text-[10px] font-bold text-slate-500 hover:text-[var(--tx)] flex items-center gap-1"
                  >
                    {copiadoPreview ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                    <span>{copiadoPreview ? '¡Copiado!' : 'Copiar'}</span>
                  </button>
                </div>

                <div className="p-3.5 bg-[#dcf8c6]/20 dark:bg-emerald-950/20 border border-emerald-500/20 rounded-2xl text-xs text-[var(--tx)] font-sans whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto select-text shadow-inner">
                  {mensajePreviewCampana}
                </div>
              </div>

              {/* Botones de Acción */}
              <div className="pt-3 border-t border-[var(--bd)] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalNuevaCampana(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold hover:bg-sf"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all"
                >
                  <Zap size={14} className="fill-white" />
                  <span>Crear Campaña Flash</span>
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
