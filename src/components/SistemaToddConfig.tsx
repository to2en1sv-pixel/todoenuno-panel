import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_TODD_BUSINESS_SETTINGS,
  buildBusinessRulesPromptBlock,
  fetchToddBusinessSettings,
  formatSaturationDaysLabel,
  getSalvadorTodayISO,
  isHolidayCurrentlyActive,
  saveToddBusinessSettings,
  type OperationalSaturationDays,
  type ToddBusinessSettings,
  type ToddCourierRule,
} from '@/lib/toddSettings';
import {
  AlertTriangle,
  Bot,
  Calendar,
  Check,
  Clock,
  Copy,
  CreditCard,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Truck,
} from 'lucide-react';

const HOLIDAY_PRESETS = [
  {
    label: 'Asueto nacional',
    text: 'Por asueto nacional no habrá despachos ni ruta de entrega ese día; los pedidos confirmados quedan agendados para el siguiente día hábil.',
  },
  {
    label: 'Alta demanda (+24h)',
    text: 'Por alta demanda de temporada, las entregas en San Salvador y departamentos pueden tomar 24 horas adicionales a lo habitual.',
  },
  {
    label: 'Vacaciones / Cierre temporal',
    text: 'Estamos en pausa temporal por vacaciones. Podemos tomar tu reserva hoy y el despacho saldrá al reanudar rutas.',
  },
];

export function SistemaToddConfig() {
  const [settings, setSettings] = useState<ToddBusinessSettings>(DEFAULT_TODD_BUSINESS_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [source, setSource] = useState<'supabase' | 'local'>('supabase');
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Nuevo courier inline
  const [newCourierName, setNewCourierName] = useState('');
  const [newCourierZones, setNewCourierZones] = useState('');

  const showNotice = (type: 'ok' | 'err', text: string) => {
    setNotice({ type, text });
    setTimeout(() => {
      setNotice(prev => (prev?.text === text ? null : prev));
    }, 4500);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchToddBusinessSettings()
      .then(res => {
        if (!active) return;
        setSettings(res.settings);
        setSource(res.source);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateField = <K extends keyof ToddBusinessSettings>(
    key: K,
    value: ToddBusinessSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasUnsaved(true);
  };

  const handleToggleCourier = (id: string) => {
    updateField(
      'couriers',
      settings.couriers.map(c => (c.id === id ? { ...c, active: !c.active } : c))
    );
  };

  const handleUpdateCourier = (id: string, patch: Partial<ToddCourierRule>) => {
    updateField(
      'couriers',
      settings.couriers.map(c => (c.id === id ? { ...c, ...patch } : c))
    );
  };

  const handleDeleteCourier = (id: string) => {
    updateField(
      'couriers',
      settings.couriers.filter(c => c.id !== id)
    );
  };

  const handleAddCourier = () => {
    const name = newCourierName.trim();
    if (!name) return;
    const next: ToddCourierRule = {
      id: `courier-${Date.now()}`,
      name,
      zones: newCourierZones.trim(),
      active: true,
    };
    updateField('couriers', [...settings.couriers, next]);
    setNewCourierName('');
    setNewCourierZones('');
  };

  const [savingSaturation, setSavingSaturation] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const res = await saveToddBusinessSettings(settings);
    setSettings(res.settings);
    setSource(res.source);
    setSaving(false);
    setHasUnsaved(false);

    if (res.source === 'supabase') {
      showNotice('ok', 'Reglas de Bot Todd guardadas en Supabase.');
    } else {
      showNotice(
        'err',
        `Guardado solo localmente (${res.error || 'revisa conexión con Supabase'}).`
      );
    }
  };

  const applySaturationPatch = async (
    patch: Partial<Pick<ToddBusinessSettings, 'operationalSaturationEnabled' | 'operationalSaturationDays'>>
  ) => {
    const nextSettings: ToddBusinessSettings = { ...settings, ...patch };
    setSettings(nextSettings);
    setSavingSaturation(true);
    const res = await saveToddBusinessSettings(nextSettings);
    setSettings(res.settings);
    setSource(res.source);
    setSavingSaturation(false);
    setHasUnsaved(false);

    if (res.source === 'supabase') {
      const label = formatSaturationDaysLabel(res.settings.operationalSaturationDays);
      showNotice(
        'ok',
        res.settings.operationalSaturationEnabled
          ? `Regla de saturación operativa activa (${label}) y guardada para Todd.`
          : 'Regla de saturación operativa desactivada. Todd volvió a los tiempos normales.'
      );
    } else {
      showNotice(
        'err',
        `Cambio guardado solo localmente (${res.error || 'revisa conexión con Supabase'}).`
      );
    }
  };

  const handleResetDefaults = () => {
    setSettings({
      ...DEFAULT_TODD_BUSINESS_SETTINGS,
      operationalSaturationEnabled: false,
      operationalSaturationDays: '2-3',
      couriers: DEFAULT_TODD_BUSINESS_SETTINGS.couriers.map(c => ({ ...c })),
    });
    setHasUnsaved(true);
    showNotice('ok', 'Valores por defecto cargados. Pulsa Guardar para aplicar.');
  };

  const todaySv = getSalvadorTodayISO();
  const holidayActiveNow = isHolidayCurrentlyActive(settings, todaySv);
  const livePromptPreview = useMemo(
    () => buildBusinessRulesPromptBlock(settings, todaySv),
    [settings, todaySv]
  );

  if (loading) {
    return (
      <div className="bg-cd bd rounded-xl p-8 flex items-center justify-center gap-2 text-xs tx-mu">
        <Loader2 size={15} className="animate-spin" />
        Cargando reglas operativas de Bot Todd...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <div
          className="bg-cd bd rounded-xl px-4 py-3 text-xs font-medium flex items-center justify-between gap-2"
          style={{
            borderColor: notice.type === 'ok' ? 'var(--ok)' : 'var(--er)',
            color: notice.type === 'ok' ? 'var(--ok)' : 'var(--er)',
          }}
        >
          <span>{notice.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* COLUMNA IZQUIERDA (8/12): BLOQUES EDITABLES */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* 0. MODO SATURACIÓN OPERATIVA (APLICA A TODO EL PAÍS) */}
          <section
            className="bg-cd bd rounded-xl p-5 space-y-4"
            style={{
              borderColor: settings.operationalSaturationEnabled ? 'var(--ac)' : undefined,
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[var(--bd)]">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <AlertTriangle
                    size={15}
                    style={{
                      color: settings.operationalSaturationEnabled ? 'var(--ac)' : 'var(--mu)',
                    }}
                  />
                  Saturación operativa · Plazo global de entrega
                </h2>
                <p className="text-xs tx-mu mt-0.5 leading-relaxed">
                  Aplica a <strong>cualquier pedido</strong> (San Salvador y todos los departamentos). Reemplaza temporalmente los tiempos normales sin borrarlos.
                </p>
              </div>

              <button
                type="button"
                disabled={savingSaturation || saving}
                onClick={() =>
                  void applySaturationPatch({
                    operationalSaturationEnabled: !settings.operationalSaturationEnabled,
                  })
                }
                className="px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 transition-opacity hover:opacity-90"
                style={
                  settings.operationalSaturationEnabled
                    ? { background: 'var(--ac)', color: '#fff' }
                    : { background: 'var(--sf)', color: 'var(--tx)', border: '1px solid var(--bd)' }
                }
              >
                {savingSaturation && <Loader2 size={13} className="animate-spin" />}
                {settings.operationalSaturationEnabled
                  ? 'Regla activa · Desactivar'
                  : 'Activar saturación operativa'}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold">Plazo que informará Todd</div>
                <p className="text-[11px] tx-mu">
                  Cambia entre 2 - 3 días y 3 - 4 días en un clic (se guarda al instante).
                </p>
              </div>

              <div className="inline-flex items-center p-1 rounded-lg bg-sf bd shrink-0">
                {(['2-3', '3-4'] as OperationalSaturationDays[]).map(opt => {
                  const selected = settings.operationalSaturationDays === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={savingSaturation || saving}
                      onClick={() =>
                        void applySaturationPatch({
                          operationalSaturationDays: opt,
                        })
                      }
                      className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                        selected
                          ? 'bg-[var(--tx)] text-[var(--cd)]'
                          : 'tx-mu hover:text-[var(--tx)]'
                      }`}
                    >
                      {formatSaturationDaysLabel(opt)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-3.5 py-2.5 rounded-lg bg-sf bd text-xs leading-relaxed">
              {settings.operationalSaturationEnabled ? (
                <span>
                  <strong>Activo ahora:</strong> para cualquier pedido (San Salvador o departamento), Todd indicará que por saturación operativa el plazo de entrega es de{' '}
                  <strong className="mono">
                    {formatSaturationDaysLabel(settings.operationalSaturationDays)}
                  </strong>{' '}
                  después de haber realizado su pedido.
                </span>
              ) : (
                <span className="tx-mu">
                  Regla apagada. Todd está usando los tiempos normales de entrega configurados abajo.
                </span>
              )}
            </div>
          </section>

          {/* 1. TIEMPOS Y COBERTURA DE ENTREGA */}
          <section className="bg-cd bd rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-[var(--bd)]">
              <div>
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Clock size={15} className="tx-mu" />
                  Tiempos de entrega y horarios
                </h2>
                <p className="text-xs tx-mu mt-0.5">
                  {settings.operationalSaturationEnabled
                    ? 'Pausados temporalmente mientras Saturación operativa está activa; vuelven automáticamente al desactivarla.'
                    : 'Información base que Todd usa cuando el cliente pregunta cuánto tarda en llegar su pedido.'}
                </p>
              </div>
              <span className="text-[11px] tx-mu shrink-0">
                {source === 'supabase' ? 'Nube (Supabase)' : 'Local'}
              </span>
            </div>

            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${settings.operationalSaturationEnabled ? 'opacity-65' : ''}`}>
              <div>
                <label className="block text-xs font-medium mb-1">
                  San Salvador / Área Metropolitana
                </label>
                <input
                  type="text"
                  value={settings.deliverySanSalvador}
                  onChange={e => updateField('deliverySanSalvador', e.target.value)}
                  placeholder="Ej. Mismo día o siguiente día hábil"
                  className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">
                  Departamentos del país
                </label>
                <input
                  type="text"
                  value={settings.deliveryDepartments}
                  onChange={e => updateField('deliveryDepartments', e.target.value)}
                  placeholder="Ej. 24 a 48 horas hábiles"
                  className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">
                  Horario de corte diario para despachos
                </label>
                <input
                  type="text"
                  value={settings.cutoffTimeNote}
                  onChange={e => updateField('cutoffTimeNote', e.target.value)}
                  placeholder="Ej. Pedidos antes de las 2:00 p. m. salen hoy"
                  className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">
                  Horario de atención humana
                </label>
                <input
                  type="text"
                  value={settings.humanSupportHours}
                  onChange={e => updateField('humanSupportHours', e.target.value)}
                  placeholder="Ej. Lunes a sábado 8:00 a. m. - 6:00 p. m."
                  className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  Costo y cobertura de envío
                </label>
                <input
                  type="text"
                  value={settings.shippingCostNote}
                  onChange={e => updateField('shippingCostNote', e.target.value)}
                  placeholder="Ej. Envío gratis en AMSS / tarifa $2.50 en departamentos"
                  className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                />
              </div>
            </div>
          </section>

          {/* 2. EMPRESAS DE ENVÍO / COURIERS */}
          <section className="bg-cd bd rounded-xl p-5 space-y-4">
            <div className="pb-3 border-b border-[var(--bd)]">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Truck size={16} style={{ color: 'var(--ac)' }} />
                Empresas de envío y couriers activos
              </h2>
              <p className="text-xs tx-mu mt-0.5">
                Todd solo mencionará las empresas que estén activas. Si pausas una, dejará de ofrecerla.
              </p>
            </div>

            <div className="space-y-2.5">
              {settings.couriers.length === 0 ? (
                <div className="py-5 px-4 bg-sf bd rounded-xl text-center text-xs tx-mu">
                  No hay empresas de envío registradas. Agrega una abajo.
                </div>
              ) : (
                settings.couriers.map(courier => (
                  <div
                    key={courier.id}
                    className={`p-3 bg-sf bd rounded-xl flex flex-col sm:flex-row sm:items-center gap-2.5 ${
                      !courier.active ? 'opacity-65' : ''
                    }`}
                  >
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={courier.name}
                        onChange={e => handleUpdateCourier(courier.id, { name: e.target.value })}
                        placeholder="Nombre empresa o motorista"
                        className="bg-cd bd rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-[var(--ac)]"
                      />
                      <input
                        type="text"
                        value={courier.zones}
                        onChange={e => handleUpdateCourier(courier.id, { zones: e.target.value })}
                        placeholder="Zonas que cubre (opcional)"
                        className="bg-cd bd rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[var(--ac)]"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleCourier(courier.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-cd bd text-xs font-semibold cursor-pointer"
                        style={{ color: courier.active ? 'var(--ok)' : 'var(--mu)' }}
                      >
                        {courier.active ? 'Activo' : 'Pausado'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCourier(courier.id)}
                        title="Eliminar empresa de envío"
                        className="p-1.5 rounded-lg bg-cd bd tx-mu hover:text-rose-500 cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Agregar nuevo courier */}
            <div className="pt-2 border-t border-[var(--bd)] grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <input
                type="text"
                value={newCourierName}
                onChange={e => setNewCourierName(e.target.value)}
                placeholder="Nueva empresa (ej. C807, Correos, Encomienda)"
                className="sm:col-span-5 bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
              />
              <input
                type="text"
                value={newCourierZones}
                onChange={e => setNewCourierZones(e.target.value)}
                placeholder="Cobertura / nota (ej. Todo el país)"
                className="sm:col-span-5 bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
              />
              <button
                type="button"
                onClick={handleAddCourier}
                disabled={!newCourierName.trim()}
                className="sm:col-span-2 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-sf bd hover:border-[var(--ac)] text-xs font-semibold disabled:opacity-40 cursor-pointer"
              >
                <Plus size={13} /> Agregar
              </button>
            </div>
          </section>

          {/* 3. MODO DÍA FESTIVO / AVISO TEMPORAL */}
          <section className="bg-cd bd rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[var(--bd)]">
              <div>
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Calendar size={16} style={{ color: 'var(--ac)' }} />
                  Días festivos, asuetos y avisos temporales
                </h2>
                <p className="text-xs tx-mu mt-0.5">
                  Actívalo en fechas especiales para que Todd ajuste promesas de entrega automáticamente.
                </p>
              </div>

              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-sf bd text-xs font-semibold cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.holidayModeEnabled}
                  onChange={e => updateField('holidayModeEnabled', e.target.checked)}
                />
                <span style={{ color: holidayActiveNow ? 'var(--ac)' : undefined }}>
                  {holidayActiveNow
                    ? 'Aviso activo hoy'
                    : settings.holidayModeEnabled
                    ? 'Programado'
                    : 'Apagado'}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">
                  Fecha inicio (opcional)
                </label>
                <input
                  type="date"
                  value={settings.holidayStartDate}
                  onChange={e => updateField('holidayStartDate', e.target.value)}
                  className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs mono outline-none focus:border-[var(--ac)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">
                  Fecha fin (opcional, se apaga solo al pasar)
                </label>
                <input
                  type="date"
                  value={settings.holidayEndDate}
                  onChange={e => updateField('holidayEndDate', e.target.value)}
                  className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs mono outline-none focus:border-[var(--ac)]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium">
                  Instrucción prioritaria para Todd durante este aviso
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {HOLIDAY_PRESETS.map(preset => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        updateField('holidayMessage', preset.text);
                        if (!settings.holidayModeEnabled) {
                          updateField('holidayModeEnabled', true);
                        }
                      }}
                      className="px-2 py-1 rounded-lg bg-sf bd text-[11px] tx-mu hover:text-[var(--tx)] hover:border-[var(--ac)] cursor-pointer"
                    >
                      + {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                rows={3}
                value={settings.holidayMessage}
                onChange={e => updateField('holidayMessage', e.target.value)}
                placeholder="Ej. Por asueto del 1 y 2 de noviembre no habrá rutas; los pedidos se agendan para el lunes 4."
                className="w-full bg-sf bd rounded-xl p-3 text-xs leading-relaxed outline-none focus:border-[var(--ac)] resize-none"
              />
            </div>
          </section>

          {/* 4. PAGOS, GARANTÍA Y REGLAS EXTRA */}
          <section className="bg-cd bd rounded-xl p-5 space-y-4">
            <div className="pb-3 border-b border-[var(--bd)]">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <CreditCard size={16} style={{ color: 'var(--ac)' }} />
                Pagos, garantía y reglas adicionales
              </h2>
              <p className="text-xs tx-mu mt-0.5">
                Políticas comerciales generales aplicables a todos los productos.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Métodos de pago</label>
                <input
                  type="text"
                  value={settings.paymentMethodsNote}
                  onChange={e => updateField('paymentMethodsNote', e.target.value)}
                  placeholder="Ej. Contra entrega o transferencia bancaria"
                  className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Garantía y cambios</label>
                <input
                  type="text"
                  value={settings.warrantyNote}
                  onChange={e => updateField('warrantyNote', e.target.value)}
                  placeholder="Ej. 7 días de garantía por defecto de fábrica"
                  className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  Datos de transferencia (opcional — dejar vacío si prefieres darlos manualmente)
                </label>
                <input
                  type="text"
                  value={settings.bankTransferInfo}
                  onChange={e => updateField('bankTransferInfo', e.target.value)}
                  placeholder="Ej. Banco Agrícola Ahorro #XXXX a nombre de..."
                  className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  Reglas libres adicionales (mayoreo, excepciones, tono)
                </label>
                <textarea
                  rows={2}
                  value={settings.extraRules}
                  onChange={e => updateField('extraRules', e.target.value)}
                  placeholder="Ej. Si preguntan por compras al mayoreo (+6 unidades), responde amablemente y escala a humano."
                  className="w-full bg-sf bd rounded-xl p-3 text-xs leading-relaxed outline-none focus:border-[var(--ac)] resize-none"
                />
              </div>

              <div className="sm:col-span-2 pt-2 border-t border-[var(--bd)]">
                <label className="flex items-start justify-between gap-3 p-3 rounded-xl bg-sf bd cursor-pointer select-none">
                  <div>
                    <div className="text-xs font-bold flex items-center gap-1.5 flex-wrap">
                      Comportamiento después de cerrar un pedido
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                        style={{
                          background: settings.autoPauseOnOrder
                            ? 'var(--cd)'
                            : 'color-mix(in srgb, var(--ok) 15%, transparent)',
                          color: settings.autoPauseOnOrder ? 'var(--ac)' : 'var(--ok)',
                        }}
                      >
                        {settings.autoPauseOnOrder
                          ? 'Pausar directo a Humano'
                          : 'Segunda fase inteligente (Activo)'}
                      </span>
                    </div>
                    <p className="text-[11px] tx-mu mt-0.5 leading-relaxed">
                      Por defecto Todd entra en <strong>segunda fase post-cierre</strong>: responde despedidas, anota indicaciones extra de entrega directo en las notas del pedido y solo escala a Humano si piden cambios o casos complejos. Marca esta casilla solo si prefieres apagar a Todd inmediatamente al cerrar el pedido.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={settings.autoPauseOnOrder}
                    onChange={e => updateField('autoPauseOnOrder', e.target.checked)}
                  />
                </label>
              </div>
            </div>
          </section>
        </div>

        {/* COLUMNA DERECHA (4/12): VISTA PREVIA EN VIVO Y ACCIONES */}
        <aside className="lg:col-span-4 flex flex-col gap-4 lg:sticky lg:top-6">
          <section className="bg-cd bd rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[var(--bd)]">
              <div className="flex items-center gap-2">
                <Sparkles size={15} style={{ color: 'var(--ok)' }} />
                <h2 className="text-sm font-bold">Vista previa para Todd</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(livePromptPreview);
                  setCopiedPrompt(true);
                  setTimeout(() => setCopiedPrompt(false), 1800);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sf bd text-[11px] font-medium cursor-pointer"
              >
                {copiedPrompt ? <Check size={12} style={{ color: 'var(--ok)' }} /> : <Copy size={12} />}
                {copiedPrompt ? 'Copiado' : 'Copiar'}
              </button>
            </div>

            <p className="text-xs tx-mu leading-relaxed">
              Este es exactamente el bloque operativo que el bridge enviará a Todd en cada conversación nueva o activa:
            </p>

            <div className="p-3.5 bg-sf bd rounded-xl text-[11px] leading-relaxed whitespace-pre-wrap mono max-h-80 overflow-y-auto">
              {livePromptPreview || 'Agrega reglas operativas para generar el contexto.'}
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="w-full py-2.5 px-4 rounded-lg text-xs font-semibold bg-[var(--tx)] text-[var(--cd)] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 hover:opacity-90"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving
                  ? 'Guardando...'
                  : hasUnsaved
                  ? 'Guardar reglas de Todd'
                  : 'Reglas guardadas'}
              </button>

              <button
                type="button"
                onClick={handleResetDefaults}
                className="w-full py-2 px-3 rounded-lg bg-sf bd text-xs font-medium flex items-center justify-center gap-1.5 hover:border-[var(--tx)] cursor-pointer"
              >
                <RotateCcw size={13} />
                Restaurar valores por defecto
              </button>
            </div>
          </section>

          <section className="bg-cd bd rounded-xl p-5 space-y-2.5">
            <h3 className="text-xs font-bold flex items-center gap-2" style={{ color: 'var(--ac)' }}>
              <Bot size={14} />
              Conexión automática con n8n · Visión &amp; Audio GPT
            </h3>
            <p className="text-xs tx-mu leading-relaxed">
              Una vez actualizado el flujo de Todd (<code className="mono">/api/todd-bridge?action=workflow</code>), cualquier cambio que guardes aquí aplica al instante sin volver a editar n8n.
            </p>
            <p className="text-xs tx-mu leading-relaxed">
              Las <strong>imágenes</strong> (productos, capturas o comprobantes) y <strong>notas de voz</strong> que llegan a UniChat se analizan automáticamente con GPT Vision + Whisper antes de pasar a Todd, y su interpretación también queda visible en la burbuja del chat.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
