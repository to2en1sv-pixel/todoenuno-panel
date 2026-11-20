import { useMemo, useRef, useState, useEffect } from 'react';
import { Send, X, Bot, RotateCcw } from 'lucide-react';
import { getDemoTableRows } from '@/lib/demoSupabase';

type ChatMessage = {
  id: string;
  sender: 'bot' | 'user';
  title?: string;
  body: string;
  time: string;
};

type DemoCopilotProps = {
  open: boolean;
  onClose: () => void;
};

function nowTimeLabel(): string {
  const d = new Date();
  return d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildLiveSandboxMetrics() {
  const orders = getDemoTableRows<any>('whatsapp_orders');
  const stock = getDemoTableRows<any>('inventory_stock');
  const ads = getDemoTableRows<any>('gastos_publicidad');
  const accounts = getDemoTableRows<any>('cash_accounts');
  const bills = getDemoTableRows<any>('panel_pagos');
  const convs = getDemoTableRows<any>('bb_conversations');
  const bids = getDemoTableRows<any>('licitacion_proveedores');

  const liquidity = accounts.reduce((acc, a) => acc + Number(a.saldo_actual || 0), 0);
  const streetOrders = orders.filter(
    (o) => !o.liquidado && ['en_camino', 'entregado'].includes(String(o.estado || ''))
  );
  const streetCash = streetOrders.reduce((acc, o) => acc + Number(o.total || 0), 0);
  const stockAtCost = stock.reduce(
    (acc, s) => acc + Math.max(0, Number(s.stock_fisico || 0)) * Number(s.costo_unitario || 0),
    0
  );
  const bills15d = bills.reduce((acc, b) => acc + Number(b.monto || 0), 0);

  const delivered = orders.filter((o) => o.estado === 'entregado');
  const cancelled = orders.filter((o) => o.estado === 'cancelado');
  const activeQueue = orders.filter((o) => ['nuevo', 'por_empacar'].includes(String(o.estado || '')));

  const deliveredRev = delivered.reduce((acc, o) => acc + Number(o.total || 0), 0);
  const avgTicket = delivered.length > 0 ? deliveredRev / delivered.length : 31.8;

  const costMap = new Map<string, number>();
  stock.forEach((s) => costMap.set(String(s.sku), Number(s.costo_unitario || 0)));

  // Real Delivered ROAS per Ad
  const adSpendMap = new Map<string, number>();
  ads.forEach((a) => {
    const code = String(a.codigo_anuncio || 'SIN_AD');
    adSpendMap.set(code, (adSpendMap.get(code) || 0) + Number(a.monto || 0));
  });

  const adStats = Array.from(adSpendMap.entries()).map(([code, spend]) => {
    const adOrders = orders.filter((o) => String(o.codigo_anuncio || '') === code);
    const adDel = adOrders.filter((o) => o.estado === 'entregado');
    const adCan = adOrders.filter((o) => o.estado === 'cancelado');
    const rev = adDel.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const cogs = adDel.reduce((sum, o) => sum + (costMap.get(String(o.catalogo_sku || '')) || 9.2), 0);
    const cancelRate = adDel.length + adCan.length > 0 ? (adCan.length / (adDel.length + adCan.length)) * 100 : 0;
    const roasReal = spend > 0 ? rev / spend : 0;
    const netContrib = rev - cogs - spend;
    return { code, spend, ordersCount: adOrders.length, deliveredCount: adDel.length, cancelRate, roasReal, netContrib };
  });

  // High-risk active orders (interior + prior cancelled phones or risky ad)
  const cancelledPhones = new Set(cancelled.map((o) => String(o.telefono || '')));
  const riskyOrders = activeQueue
    .map((o) => {
      let risk = 14;
      const reasons: string[] = [];
      if (cancelledPhones.has(String(o.telefono || ''))) {
        risk += 38;
        reasons.push('teléfono con rechazo previo');
      }
      if (['San Miguel', 'Usulután'].includes(String(o.departamento || ''))) {
        risk += 18;
        reasons.push(`ruta interior (${o.departamento})`);
      }
      if (String(o.codigo_anuncio || '') === 'AD-VID-04') {
        risk += 16;
        reasons.push('anuncio AD-VID-04 (alta devolución)');
      }
      if (String(o.metodo_pago || '').toLowerCase().includes('contra entrega')) {
        risk += 6;
      }
      return { order: o, risk: Math.min(92, risk), reasons };
    })
    .filter((r) => r.risk >= 40)
    .sort((a, b) => b.risk - a.risk);

  // Stockout prediction
  const lowStockItem =
    stock.find((s) => Number(s.stock_disponible || 0) <= Number(s.stock_minimo_alerta || 10)) || stock[1] || stock[0];
  const dailyVel = 2.1;
  const daysLeft = lowStockItem ? Number((Number(lowStockItem.stock_disponible || 0) / dailyVel).toFixed(1)) : 3.5;
  const reorder14dUnits = Math.ceil(dailyVel * 14);
  const bestBid = bids
    .filter((b) => b.licitacion_id === 'lic-demo-03' && b.precio_ofertado)
    .sort((a, b) => Number(a.precio_ofertado) - Number(b.precio_ofertado))[0];
  const unitCost = bestBid ? Number(bestBid.precio_ofertado) : Number(lowStockItem?.costo_unitario || 10.8);
  const reorderCost = reorder14dUnits * unitCost;

  const avgCogs = 9.15;
  const grossMarginUnit = avgTicket - avgCogs - 3.2; // minus average shipping
  const dailyFixedBurn = 44.5; // ads + opex daily baseline
  const breakEvenOrdersDay = Math.ceil(dailyFixedBurn / Math.max(5, grossMarginUnit));

  return {
    liquidity,
    streetCash,
    streetCount: streetOrders.length,
    stockAtCost,
    bills15d,
    deliveredCount: delivered.length,
    cancelledCount: cancelled.length,
    activeQueueCount: activeQueue.length,
    avgTicket,
    avgCogs,
    grossMarginUnit,
    dailyFixedBurn,
    breakEvenOrdersDay,
    adStats,
    riskyOrders,
    lowStockItem,
    daysLeft,
    reorder14dUnits,
    reorderCost,
    bestBidPrice: unitCost,
    convsCount: convs.length,
  };
}

function generateCommandReply(command: string): { title: string; body: string } {
  const m = buildLiveSandboxMetrics();
  const q = command.trim().toLowerCase();

  if (q === '/radar' || q.includes('radar') || q.includes('inferencia')) {
    const winner = [...m.adStats].sort((a, b) => b.netContrib - a.netContrib)[0];
    const deceptive = [...m.adStats].sort((a, b) => b.cancelRate - a.cancelRate)[0];
    const riskLines =
      m.riskyOrders.length > 0
        ? m.riskyOrders
            .slice(0, 3)
            .map(
              (r) =>
                `• ${r.order.pedido_codigo} (${r.order.nombre_cliente} · ${r.order.departamento}) — Riesgo ${r.risk}%\n  Motivo: ${r.reasons.join(', ')}. Acción: reconfirmar por WhatsApp antes de empacar.`
            )
            .join('\n')
        : '• Sin pedidos de riesgo elevado en cola activa.';

    return {
      title: 'Radar Predictivo IA (/radar)',
      body: [
        '1) Diagnóstico causal del día (ritmo vs mismo día semana):',
        `• Ritmo operativo: +11% sobre línea base (tráfico estable y cierre Todd en 21.4%).`,
        '',
        '2) Scoring pre-despacho (Nuevo / Por empacar):',
        riskLines,
        '',
        '3) Quiebre de stock cruzado con liquidez:',
        `• ${m.lowStockItem?.sku} (${m.lowStockItem?.nombre}): ${m.lowStockItem?.stock_disponible}u libres → ~${m.daysLeft} días de cobertura.`,
        `• Reposición 14d (${m.reorder14dUnits}u @ ${money(m.bestBidPrice)} puja Klaus): ${money(m.reorderCost)} — Viable (liquidez ${money(m.liquidity)}).`,
        '',
        '4) ROAS real post-entrega por anuncio:',
        winner
          ? `• Ganador: ${winner.code} → ROAS real ${winner.roasReal.toFixed(2)}x · Contribución neta ${money(winner.netContrib)} (${winner.cancelRate.toFixed(0)}% rechazo).`
          : '',
        deceptive
          ? `• Alerta engañosa: ${deceptive.code} → ${deceptive.cancelRate.toFixed(0)}% rechazo · Contribución ${money(deceptive.netContrib)}. Recomendación: pausar o exigir anticipo en interior.`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  if (q === '/salud' || q.includes('salud') || q.includes('liquidez') || q.includes('finanzas')) {
    const netWorth = m.liquidity + m.streetCash + m.stockAtCost - m.bills15d;
    const runwayDays = Math.round(m.liquidity / m.dailyFixedBurn);
    return {
      title: 'Salud Financiera en Tiempo Real (/salud)',
      body: [
        `• Índice de Salud Financiera: 86 / 100 (Sólido)`,
        `• Liquidez inmediata en cuentas: ${money(m.liquidity)}`,
        `• Dinero en calle por liquidar (${m.streetCount} pedidos): ${money(m.streetCash)}`,
        `• Inventario físico valorado a costo: ${money(m.stockAtCost)}`,
        `• Compromisos próximos 15 días: ${money(m.bills15d)}`,
        `• Valor operativo neto estimado: ${money(netWorth)}`,
        `• Oxígeno de caja (runway sin ventas): ~${runwayDays} días`,
        '',
        `Diagnóstico: Caja holgada para adjudicar reposición de ${m.lowStockItem?.sku} (${money(m.reorderCost)}) sin tensionar pagos fijos.`,
      ].join('\n'),
    };
  }

  if (q === '/objeciones' || q.includes('objecion')) {
    return {
      title: 'Minería Semántica de Chats No Cerrados (/objeciones)',
      body: [
        'Muestra analizada: conversaciones no cerradas de Todd (últimas 48h).',
        '',
        '1) Top objeciones detectadas:',
        '• Costo de envío departamental ($4.50 en interior): frena cierre en pedidos < $35.',
        '• Ventana de entrega vespertina (clientes que reciben después de 6:00 PM).',
        '',
        '2) Demanda oculta / combos solicitados:',
        '• Combo 2× Audífonos Pro ANC para parejas (solicitado sin tarifa publicada en guión).',
        '',
        '3) Acciones sugeridas para Todd:',
        '• Activar envío gratis departamental desde $50 o agregar upsell de $17.99 para absorber flete.',
        '• Agregar oferta oficial "Pack Dúo ANC $62.99" al catálogo dinámico de Todd.',
      ].join('\n'),
    };
  }

  if (q === '/hoy' || q.includes('brief') || q.includes('resumen')) {
    return {
      title: 'Brief Ejecutivo Diario (/hoy)',
      body: [
        `• Cola activa (Nuevo + Por empacar): ${m.activeQueueCount} pedidos listos para Alistado.`,
        `• Entregados acumulados (muestra): ${m.deliveredCount} · Ticket promedio ${money(m.avgTicket)}.`,
        `• Liquidez disponible: ${money(m.liquidity)} · En calle: ${money(m.streetCash)}.`,
        `• Licitación Klaus activa: 3 ofertas recibidas para NX-AUD-02 (mejor puja ${money(m.bestBidPrice)}/u vs $10.80 ref).`,
        '',
        'RADAR PREDICTIVO:',
        `• ${m.riskyOrders.length} pedidos en cola con riesgo >= 40% por reconfirmar antes de despacho.`,
        `• ${m.lowStockItem?.sku} con ${m.daysLeft} días de stock; adjudicar licitación hoy.`,
      ].join('\n'),
    };
  }

  // Counterfactual simulator: scaling ads
  if (q.includes('subo') || q.includes('ads') || q.includes('pauta') || q.includes('escalar')) {
    const matchNum = q.match(/\$?\s*(\d+(?:\.\d+)?)/);
    const extraDaily = matchNum ? Number(matchNum[1]) : 30;
    const roasWinner = 4.2;
    const expectedOrdersDay = Number(((extraDaily * roasWinner) / m.avgTicket).toFixed(1));
    const netPerOrder = m.grossMarginUnit - extraDaily / Math.max(1, expectedOrdersDay);
    const monthlyExtraNet = Math.round(expectedOrdersDay * netPerOrder * 30);
    const extraStock14d = Math.ceil(expectedOrdersDay * 14 * m.avgCogs);
    return {
      title: `Simulador Contrafactual (+${money(extraDaily)}/día en Ads)`,
      body: [
        `Constantes reales del sandbox: ticket ${money(m.avgTicket)} · COGS ${money(m.avgCogs)} · margen contribución ${money(m.grossMarginUnit)}/pedido.`,
        '',
        `Escenario aplicando +${money(extraDaily)}/día únicamente sobre ganadores (AD-UGC-01 / AD-DEMO-02):`,
        `• Pedidos incrementales estimados: +${expectedOrdersDay} pedidos/día`,
        `• Capital adicional requerido en stock (14 días): ~${money(extraStock14d)}`,
        `• Utilidad neta mensual incremental proyectada: +${money(Math.max(0, monthlyExtraNet))}`,
        '',
        `Restricción detectada: No escalar hasta adjudicar la reposición de ${m.lowStockItem?.sku} (${m.daysLeft}d restantes) y pausar AD-VID-04.`,
      ].join('\n'),
    };
  }

  // Counterfactual: break-even / monthly goal
  if (q.includes('cuantos') || q.includes('cuántos') || q.includes('equilibrio') || q.includes('mes')) {
    const monthlyGoalOrders = Math.ceil((m.dailyFixedBurn * 30 + m.reorderCost) / Math.max(8, m.grossMarginUnit));
    return {
      title: 'Simulación de Punto de Equilibrio y Meta Mensual',
      body: [
        `• Punto de equilibrio diario operativo: ${m.breakEvenOrdersDay} pedidos entregados/día (cubre quema diaria de ${money(m.dailyFixedBurn)}).`,
        `• Para cubrir gastos fijos + reposición 14d de stock (${money(m.reorderCost)}): ${monthlyGoalOrders} pedidos entregados/mes (~${(monthlyGoalOrders / 30).toFixed(1)}/día).`,
        `• Con tu margen neto por pedido de ${money(m.grossMarginUnit)}, cada pedido adicional sobre el equilibrio suma caja libre directa.`,
      ].join('\n'),
    };
  }

  // Pause ad question
  if (q.includes('pausar') || q.includes('anuncio') || q.includes('roas')) {
    return {
      title: 'Auditoría de Anuncios por Contribución Neta',
      body: [
        '• PAUSAR HOY: AD-VID-04 (TikTok) — concentra el mayor volumen de rechazos en interior (San Miguel / Usulután), destruyendo margen por flete perdido.',
        '• ESCALAR: AD-UGC-01 (Meta) — mayor ROAS real post-entrega y menor tasa de devolución en área metropolitana.',
        '• MANTENER: AD-DEMO-02 y AD-PROMO-03 con aporte neto positivo constante.',
      ].join('\n'),
    };
  }

  return {
    title: 'Respuesta del Copiloto IA (Sandbox)',
    body: [
      `Consulté los datos vivos del entorno demo (${m.deliveredCount} entregados, ${m.activeQueueCount} en cola, liquidez ${money(m.liquidity)}).`,
      'Puedes probar comandos directos como /radar, /salud, /objeciones, /hoy o preguntas contrafactuales como "¿Qué pasa si subo $30/día en ads?".',
    ].join('\n'),
  };
}

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome-1',
    sender: 'bot',
    title: 'Nexo Copiloto Ejecutivo (Simulador Telegram)',
    body: 'Este simulador ejecuta las mismas consultas e inferencias que el bot real de Telegram, calculadas en vivo sobre los datos sintéticos de Nexo Store LATAM.\n\nSelecciona un comando rápido o escribe una pregunta contrafactual.',
    time: nowTimeLabel(),
  },
];

export function TelegramCopilotSimulator({ open, onClose }: DemoCopilotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const quickCommands = useMemo(
    () => [
      { label: 'Radar IA (/radar)', cmd: '/radar' },
      { label: 'Salud Financiera (/salud)', cmd: '/salud' },
      { label: 'Objeciones Chats (/objeciones)', cmd: '/objeciones' },
      { label: 'Brief Diario (/hoy)', cmd: '/hoy' },
    ],
    []
  );

  const sampleQuestions = useMemo(
    () => [
      '¿Qué pasa si subo $30/día en ads?',
      '¿Cuántos pedidos necesito este mes?',
      '¿Qué anuncio debo pausar hoy?',
    ],
    []
  );

  if (!open) return null;

  const dispatchQuery = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const t = nowTimeLabel();
    const reply = generateCommandReply(clean);
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, sender: 'user', body: clean, time: t },
      { id: `b-${Date.now() + 1}`, sender: 'bot', title: reply.title, body: reply.body, time: t },
    ]);
    setInput('');
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]">
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label="Simulador de Copiloto Telegram IA"
        className="relative z-10 w-full max-w-[480px] h-full bg-cd border-l border-[var(--bd)] flex flex-col text-[var(--tx)] shadow-2xl"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[var(--tx)] text-[var(--cd)] flex items-center justify-center shrink-0">
              <Bot size={16} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold truncate">Copiloto Telegram IA</h2>
              <p className="text-xs tx-mu truncate">Inferencia en vivo sobre datos del sandbox</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setMessages(INITIAL_MESSAGES)}
              className="p-2 rounded-lg text-[var(--mu)] hover:text-[var(--tx)] hover:bg-sf transition-colors"
              title="Limpiar conversación"
              aria-label="Limpiar conversación"
            >
              <RotateCcw size={15} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-[var(--mu)] hover:text-[var(--tx)] hover:bg-sf transition-colors"
              aria-label="Cerrar simulador"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Command Strip */}
        <div className="px-5 py-3 border-b border-[var(--bd)] bg-sf/60 flex flex-wrap gap-1.5">
          {quickCommands.map((item) => (
            <button
              key={item.cmd}
              type="button"
              onClick={() => dispatchQuery(item.cmd)}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-cd border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--tx)] transition-colors whitespace-nowrap"
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-3.5 bg-[var(--bg)]">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col max-w-[92%] ${msg.sender === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
            >
              <div
                className={`rounded-xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-line ${
                  msg.sender === 'user'
                    ? 'bg-[var(--tx)] text-[var(--cd)]'
                    : 'bg-cd border border-[var(--bd)] text-[var(--tx)]'
                }`}
              >
                {msg.title && (
                  <div className="text-xs font-semibold mb-1.5 pb-1.5 border-b border-[var(--bd)] text-[var(--tx)]">
                    {msg.title}
                  </div>
                )}
                <div className="mono text-[12px] leading-[1.6] font-normal">{msg.body}</div>
              </div>
              <span className="text-[11px] tx-mu mt-1 px-1 mono">{msg.time}</span>
            </div>
          ))}
        </div>

        {/* Counterfactual suggestions + Input */}
        <div className="p-4 border-t border-[var(--bd)] bg-cd flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-1.5">
            {sampleQuestions.map((sq) => (
              <button
                key={sq}
                type="button"
                onClick={() => dispatchQuery(sq)}
                className="text-[11px] tx-mu hover:text-[var(--tx)] underline underline-offset-2 text-left transition-colors"
              >
                {sq}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              dispatchQuery(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregunta ej: ¿Qué pasa si subo $40/día en ads?"
              className="flex-1 px-3 py-2.5 text-xs rounded-lg bg-sf border border-[var(--bd)] text-[var(--tx)] placeholder:text-[var(--mu)] focus:outline-none focus:border-[var(--tx)]"
            />
            <button
              type="submit"
              className="px-3.5 py-2.5 rounded-lg bg-[var(--tx)] text-[var(--cd)] text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity shrink-0"
            >
              <Send size={13} />
              Enviar
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}
