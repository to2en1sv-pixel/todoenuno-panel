import { useState, useMemo } from 'react';
import { 
  ShieldAlert, 
  Search, 
  Plus, 
  Trash2, 
  AlertTriangle, 
  CheckCircle2, 
  Phone, 
  UserX, 
  UserCheck, 
  DollarSign, 
  X, 
  ExternalLink,
  MessageCircle,
  Clock,
  Shield,
  Layers,
  FileWarning
} from 'lucide-react';
import { 
  getBlacklistEntries, 
  addOrUpdateBlacklist, 
  removeBlacklistEntry, 
  cleanPhone, 
  formatPhoneDisplay, 
  BlacklistEntry, 
  evaluateCustomerRisk 
} from '@/lib/blacklist';
import { formatCurrency } from '@/lib/rentabilidad';

interface Props {
  orders: any[];
  onOpenPedido?: (pedido: any) => void;
}

export function DirectorioListaNegra({ orders, onOpenPedido }: Props) {
  const [entries, setEntries] = useState<BlacklistEntry[]>(() => getBlacklistEntries());
  const [busqueda, setBusqueda] = useState('');
  const [filtroSeveridad, setFiltroSeveridad] = useState<string>('todos');
  const [modalAbierto, setModalAbierto] = useState(false);

  // Formulario de nuevo reporte
  const [telefonoNuevo, setTelefonoNuevo] = useState('');
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [motivoNuevo, setMotivoNuevo] = useState('Cliente no contestó llamadas/mensajes al llegar');
  const [severidadNueva, setSeveridadNueva] = useState<'alta' | 'media' | 'baja'>('alta');
  const [reportadoPorNuevo, setReportadoPorNuevo] = useState('Motorista en Ruta');

  // Recargar entradas
  const recargar = () => {
    setEntries(getBlacklistEntries());
  };

  // Clientes detectados automáticamente con cancelaciones en whatsapp_orders
  const clientesAutoDetectados = useMemo(() => {
    const phoneMap = new Map<string, {
      clean: string;
      nombre: string;
      cancelados: number;
      entregados: number;
      motivos: string[];
      nombres: Set<string>;
    }>();

    orders.forEach(o => {
      const c = cleanPhone(o.telefono);
      if (!c || c.length < 8) return;

      if (!phoneMap.has(c)) {
        phoneMap.set(c, {
          clean: c,
          nombre: o.nombre_cliente || 'Sin nombre',
          cancelados: 0,
          entregados: 0,
          motivos: [],
          nombres: new Set()
        });
      }

      const pStat = phoneMap.get(c)!;
      if (o.nombre_cliente?.trim()) pStat.nombres.add(o.nombre_cliente.trim());

      const est = String(o.estado || '').toLowerCase();
      if (est === 'cancelado') {
        pStat.cancelados++;
        if (o.motivo_cancelacion?.trim()) pStat.motivos.push(o.motivo_cancelacion.trim());
      } else if (est === 'entregado') {
        pStat.entregados++;
      }
    });

    // Filtrar solo los que tienen al menos 1 cancelación y no están ya en la lista negra manual
    const blacklistPhones = new Set(entries.map(e => cleanPhone(e.telefono)));

    return Array.from(phoneMap.values())
      .filter(p => p.cancelados >= 1 && !blacklistPhones.has(p.clean))
      .sort((a, b) => b.cancelados - a.cancelados);
  }, [orders, entries]);

  // Filtrado de la lista manual
  const entriesFiltradas = useMemo(() => {
    return entries.filter(e => {
      const matchesSearch = 
        e.telefono.includes(busqueda.trim()) ||
        e.nombreCliente.toLowerCase().includes(busqueda.toLowerCase()) ||
        e.motivo.toLowerCase().includes(busqueda.toLowerCase()) ||
        e.aliasNombres.some(a => a.toLowerCase().includes(busqueda.toLowerCase()));

      const matchesSev = filtroSeveridad === 'todos' || e.severidad === filtroSeveridad;
      return matchesSearch && matchesSev;
    });
  }, [entries, busqueda, filtroSeveridad]);

  // Métricas de Impacto
  const metricas = useMemo(() => {
    const totalBoletinados = entries.length;
    // Estimación: flete promedio de $3.50 por paquete fallido
    const fletesEvitadosMonto = totalBoletinados * 3.50;

    let clientesConMultiplesNombres = 0;
    entries.forEach(e => {
      if (e.aliasNombres && e.aliasNombres.length > 1) clientesConMultiplesNombres++;
    });

    return {
      totalBoletinados,
      fletesEvitadosMonto,
      autoDetectados: clientesAutoDetectados.length,
      clientesConMultiplesNombres
    };
  }, [entries, clientesAutoDetectados]);

  // Guardar nuevo boletinado
  const handleGuardarNuevo = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = cleanPhone(telefonoNuevo);
    if (!clean || clean.length < 8) {
      alert('Ingresa un número de teléfono válido (mínimo 8 dígitos).');
      return;
    }

    addOrUpdateBlacklist({
      telefono: clean,
      nombreCliente: nombreNuevo.trim() || 'Cliente Desconocido',
      aliasNombres: nombreNuevo.trim() ? [nombreNuevo.trim()] : [],
      motivo: motivoNuevo.trim(),
      severidad: severidadNueva,
      reportadoPor: reportadoPorNuevo.trim() || 'Administración',
      fecha: new Date().toISOString()
    });

    setModalAbierto(false);
    setTelefonoNuevo('');
    setNombreNuevo('');
    recargar();
  };

  // Boletinar rápido un cliente auto-detectado
  const handleBoletinarAutoDetectado = (item: any) => {
    addOrUpdateBlacklist({
      telefono: item.clean,
      nombreCliente: item.nombre,
      aliasNombres: Array.from(item.nombres),
      motivo: item.motivos.length > 0 ? item.motivos[0] : `${item.cancelados} cancelaciones registradas en sistema`,
      severidad: item.cancelados >= 2 ? 'alta' : 'media',
      reportadoPor: 'Sistema COD Engine (Cancelaciones Recurrentes)',
      fecha: new Date().toISOString()
    });
    recargar();
  };

  // Quitar de lista negra
  const handleQuitar = (telefono: string) => {
    if (confirm(`¿Rehabilitar y quitar el teléfono ${formatPhoneDisplay(telefono)} de la lista negra?`)) {
      removeBlacklistEntry(telefono);
      recargar();
    }
  };

  return (
    <div className="space-y-6">
      {/* HEADER DEL SUBMÓDULO DICOM INTERNO */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-cd p-5 rounded-2xl border border-rose-500/20 gap-4 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500 shrink-0 mt-0.5">
            <ShieldAlert size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-[var(--tx)]">
                Directorio Antifraude & DICOM Interno COD
              </h2>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 border border-rose-500/30">
                Protección de Fletes
              </span>
            </div>
            <p className="text-xs tx-mu mt-1">
              Registro preventivo de clientes con cancelaciones en puerta, teléfonos falsos o reportes de motoristas para exigir flete previo o bloquear despacho.
            </p>
          </div>
        </div>

        <button
          onClick={() => setModalAbierto(true)}
          className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-rose-600/20 transition-all shrink-0"
        >
          <Plus size={15} /> Boletinar Número
        </button>
      </div>

      {/* TARJETAS DE IMPACTO Y PROTECCIÓN FINANCIERA */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Números Boletinados</span>
          <div className="text-2xl font-black font-mono mt-1 text-rose-500">
            {metricas.totalBoletinados} <span className="text-xs font-normal tx-mu">clientes</span>
          </div>
          <span className="text-[10px] tx-mu mt-0.5 block">En Lista Negra activa</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Fletes Ahorrados ($)</span>
          <div className="text-2xl font-black font-mono mt-1 text-emerald-600">
            {formatCurrency(metricas.fletesEvitadosMonto)}
          </div>
          <span className="text-[10px] tx-mu mt-0.5 block">Est. ~$3.50 flete/paquete</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Alias Detectados</span>
          <div className="text-2xl font-black font-mono mt-1 text-indigo-500">
            {metricas.clientesConMultiplesNombres} <span className="text-xs font-normal tx-mu">cambiaron nombre</span>
          </div>
          <span className="text-[10px] tx-mu mt-0.5 block">Mismo número, distinto nombre</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">En Observación Automática</span>
          <div className="text-2xl font-black font-mono mt-1 text-amber-500">
            {metricas.autoDetectados} <span className="text-xs font-normal tx-mu">sospechosos</span>
          </div>
          <span className="text-[10px] tx-mu mt-0.5 block">Con cancelaciones en pedidos</span>
        </div>
      </div>

      {/* BARRA DE BÚSQUEDA Y FILTROS */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-cd p-3 rounded-2xl border border-[var(--bd)]">
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 tx-mu" />
          <input
            type="text"
            placeholder="Buscar por teléfono, nombre o motivo..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-sf border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-rose-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs tx-mu font-bold">Severidad:</span>
          <div className="flex bg-sf p-1 rounded-xl border border-[var(--bd)] text-xs font-semibold">
            {[
              { id: 'todos', label: 'Todos' },
              { id: 'alta', label: '🔴 Alta' },
              { id: 'media', label: '🟡 Media' },
              { id: 'baja', label: '⚪ Baja' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFiltroSeveridad(f.id)}
                className={`px-3 py-1 rounded-lg transition-colors whitespace-nowrap ${
                  filtroSeveridad === f.id
                    ? 'bg-cd shadow-sm text-[var(--tx)] font-bold'
                    : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* TABLA PRINCIPAL DE NÚMEROS BOLETINADOS */}
      <div className="bg-cd rounded-2xl border border-[var(--bd)] overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
          <div className="flex items-center gap-2">
            <UserX size={16} className="text-rose-500" />
            <h3 className="font-bold text-xs uppercase text-[var(--tx)]">
              Números en Lista Negra ({entriesFiltradas.length})
            </h3>
          </div>
          <span className="text-[11px] tx-mu">Se alertarán en tiempo real al ingresar un pedido</span>
        </div>

        {entriesFiltradas.length === 0 ? (
          <div className="p-12 text-center text-xs tx-mu">
            {busqueda ? 'No se encontraron números con ese criterio.' : 'No hay números boletinados manualmente todavía.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-sf/50 border-b border-[var(--bd)] text-[10px] tx-mu uppercase font-bold">
                <tr>
                  <th className="p-3">Teléfono (WhatsApp)</th>
                  <th className="p-3">Cliente / Alias</th>
                  <th className="p-3">Motivo del Reporte</th>
                  <th className="p-3">Reportado Por</th>
                  <th className="p-3 text-center">Severidad</th>
                  <th className="p-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {entriesFiltradas.map(e => {
                  const evalRisk = evaluateCustomerRisk(e.telefono, orders);

                  return (
                    <tr key={e.telefono} className="hover:bg-sf/40 transition-colors">
                      {/* Teléfono */}
                      <td className="p-3 font-mono font-bold text-rose-600 dark:text-rose-400">
                        <div className="flex items-center gap-2">
                          <span>{e.telefonoDisplay}</span>
                          <a
                            href={`https://wa.me/503${e.telefono}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-500 hover:text-emerald-400 p-1 rounded-lg bg-emerald-500/10"
                            title="Ver en WhatsApp"
                          >
                            <MessageCircle size={12} />
                          </a>
                        </div>
                      </td>

                      {/* Nombres y Alias */}
                      <td className="p-3">
                        <span className="font-bold text-[var(--tx)] block">{e.nombreCliente}</span>
                        {e.aliasNombres && e.aliasNombres.length > 1 && (
                          <span className="text-[10px] tx-mu block mt-0.5">
                            Alias: {e.aliasNombres.join(', ')}
                          </span>
                        )}
                        {evalRisk.cancelados > 0 && (
                          <span className="text-[9px] font-bold text-rose-500 block mt-0.5">
                            {evalRisk.cancelados} cancelaciones en pedidos históricos
                          </span>
                        )}
                      </td>

                      {/* Motivo */}
                      <td className="p-3">
                        <span className="text-xs text-[var(--tx)] block font-medium">{e.motivo}</span>
                        <span className="text-[10px] tx-mu block mt-0.5">
                          {new Date(e.fecha).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </td>

                      {/* Reportado por */}
                      <td className="p-3 font-semibold tx-mu text-[11px]">
                        {e.reportadoPor}
                      </td>

                      {/* Severidad */}
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          e.severidad === 'alta' ? 'bg-rose-500/10 text-rose-600 border border-rose-500/30' :
                          e.severidad === 'media' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/30' :
                          'bg-slate-500/10 text-slate-500 border border-slate-500/30'
                        }`}>
                          {e.severidad.toUpperCase()}
                        </span>
                      </td>

                      {/* Acciones */}
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleQuitar(e.telefono)}
                          className="px-2.5 py-1 text-[11px] font-bold text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition-colors"
                          title="Quitar de lista negra"
                        >
                          Rehabilitar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECCIÓN DE CLIENTES DETECTADOS POR CANCELACIONES RECURRENTES EN PEDIDOS */}
      {clientesAutoDetectados.length > 0 && (
        <div className="bg-cd rounded-2xl border border-amber-500/20 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-500">
              <FileWarning size={18} />
              <h3 className="font-bold text-sm text-[var(--tx)]">
                Detección Automática: Clientes con Cancelaciones Previas ({clientesAutoDetectados.length})
              </h3>
            </div>
            <span className="text-[10px] tx-mu">Detectados por el historial de whatsapp_orders</span>
          </div>

          <p className="text-xs tx-mu leading-relaxed">
            Estos números tienen al menos 1 pedido cancelado en su historial pero aún no están en la lista negra estricta. Puedes boletinarlos con 1 clic para que exijan flete anticipado:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
            {clientesAutoDetectados.slice(0, 6).map(c => (
              <div key={c.clean} className="p-3 rounded-xl bg-sf border border-[var(--bd)] flex flex-col justify-between space-y-2">
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono font-bold text-xs text-[var(--tx)]">
                        {formatPhoneDisplay(c.clean)}
                      </span>
                      <h4 className="font-semibold text-xs text-[var(--tx)] mt-0.5">{c.nombre}</h4>
                    </div>

                    <span className="text-[10px] font-black font-mono px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
                      {c.cancelados} canc.
                    </span>
                  </div>

                  {c.motivos.length > 0 && (
                    <p className="text-[10px] text-rose-400 mt-1.5 italic line-clamp-1">
                      "{c.motivos[0]}"
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-[var(--bd)] flex items-center justify-between">
                  <span className="text-[10px] tx-mu">
                    {c.entregados} entregados
                  </span>

                  <button
                    onClick={() => handleBoletinarAutoDetectado(c)}
                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1"
                  >
                    <ShieldAlert size={12} /> Boletinar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: BOLETINAR NUEVO NÚMERO */}
      {modalAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setModalAbierto(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2 text-rose-500">
                <ShieldAlert size={18} />
                <h3 className="font-bold text-sm">Boletinar Cliente en Lista Negra</h3>
              </div>
              <button onClick={() => setModalAbierto(false)} className="p-1 rounded-lg hover:bg-black/10">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleGuardarNuevo} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block text-[10px] font-bold uppercase tx-mu mb-1">
                  Teléfono / WhatsApp *
                </label>
                <input
                  type="text"
                  placeholder="Ej. 7123-4567 o 50371234567"
                  value={telefonoNuevo}
                  onChange={e => setTelefonoNuevo(e.target.value)}
                  required
                  className="w-full p-2.5 bg-sf border border-[var(--bd)] rounded-xl font-mono text-xs font-bold outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tx-mu mb-1">
                  Nombre del Cliente (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ej. Juan Pérez"
                  value={nombreNuevo}
                  onChange={e => setNombreNuevo(e.target.value)}
                  className="w-full p-2.5 bg-sf border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tx-mu mb-1">
                  Motivo del Reporte *
                </label>
                <select
                  value={motivoNuevo}
                  onChange={e => setMotivoNuevo(e.target.value)}
                  className="w-full p-2.5 bg-sf border border-[var(--bd)] rounded-xl text-xs font-semibold outline-none focus:border-rose-500 mb-1.5"
                >
                  <option value="Cliente no contestó llamadas/mensajes al llegar">Cliente no contestó llamadas/mensajes al llegar</option>
                  <option value="Dijo que no tenía dinero para pagar">Dijo que no tenía dinero para pagar</option>
                  <option value="Dirección falsa o inexistente">Dirección falsa o inexistente</option>
                  <option value="Rechazó paquete en puerta sin motivo">Rechazó paquete en puerta sin motivo</option>
                  <option value="Pide de varios números y nunca recibe">Pide de varios números y nunca recibe</option>
                  <option value="Comportamiento agresivo / sospechoso">Comportamiento agresivo / sospechoso</option>
                </select>

                <input
                  type="text"
                  placeholder="Detalles adicionales (opcional)..."
                  value={motivoNuevo}
                  onChange={e => setMotivoNuevo(e.target.value)}
                  className="w-full p-2 bg-sf border border-[var(--bd)] rounded-xl text-[11px] outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase tx-mu mb-1">Severidad</label>
                  <select
                    value={severidadNueva}
                    onChange={e => setSeveridadNueva(e.target.value as any)}
                    className="w-full p-2 bg-sf border border-[var(--bd)] rounded-xl text-xs font-semibold outline-none focus:border-rose-500"
                  >
                    <option value="alta">🔴 Alta (Bloqueo / Flete Obligatorio)</option>
                    <option value="media">🟡 Media (Reconfirmación estricta)</option>
                    <option value="baja">⚪ Baja (Observación)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tx-mu mb-1">Reportado Por</label>
                  <input
                    type="text"
                    value={reportadoPorNuevo}
                    onChange={e => setReportadoPorNuevo(e.target.value)}
                    placeholder="Ej. Motorista Central 1"
                    className="w-full p-2 bg-sf border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-rose-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--bd)] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalAbierto(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs shadow-lg transition-colors"
                >
                  Boletinar Cliente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
