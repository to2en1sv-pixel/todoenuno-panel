# TODOENUNO OS — Mapa Oficial de Eventos (Fase 0 & Sprint 1)

Documento de auditoría y arquitectura para el **OS Event Store**.
Este mapa define la relación estricta entre las fuentes de datos actuales y el flujo normalizado de eventos de TodoEnUno OS.

---

## 1. Visión y Principio Rector

> **"No construyamos OS Events como una tabla. Construyámoslo como el núcleo de TodoEnUno OS."**

Todos los módulos del ecosistema (Pedidos, Marketing, UniChat, Social Inbox, Proveedores, Logística, Rentabilidad, Finanzas, OS Memory, IA) dependerán de esta misma capa de eventos inmutables.

Flujo de ciclo de vida unificado:
```
Cliente escribió (chat.message.received)
       ↓
Lead generado (lead.generated)
       ↓
Pedido creado (order.created)
       ↓
Pedido confirmado / por empacar (order.confirmed)
       ↓
Pedido enviado / en camino (order.shipped)
       ↓
Pedido entregado (order.delivered)
       ↓
Dinero cobrado (finance.income.created)
```

---

## 2. Mapa de Tablas Actuales → Eventos Normalizados

| Módulo | Tabla Origen | Operación | Evento Normalizado | Dominio | Payload Clave |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Pedidos** | `whatsapp_orders` | INSERT (estado 'nuevo') | `order.created` | `order` | `order_id, pedido_codigo, total, sku, telefono, nombre_cliente, codigo_anuncio, metodo_pago` |
| **Pedidos** | `whatsapp_orders` | UPDATE a 'por_empacar' o 'confirmado' | `order.confirmed` | `order` | `order_id, pedido_codigo, total, sku, estado_anterior, estado` |
| **Logística** | `whatsapp_orders` | UPDATE a 'en_camino' o 'enviado' | `order.shipped` | `order` | `order_id, pedido_codigo, total, sku, estado_anterior, estado` |
| **Logística** | `whatsapp_orders` | UPDATE a 'entregado' | `order.delivered` | `order` | `order_id, pedido_codigo, total, sku, estado_anterior, estado` |
| **Pedidos** | `whatsapp_orders` | UPDATE a 'cancelado' o 'cancelada' | `order.cancelled` | `order` | `order_id, pedido_codigo, total, motivo, estado_anterior, estado` |
| **Mensajería** | `fb_messages`, `bb_messages` | INSERT (inbound) | `chat.message.received` | `chat` | `conversation_id, sender_id, text, channel (facebook/whatsapp/bot)` |
| **Mensajería** | `fb_messages`, `bb_messages` | INSERT (outbound) | `chat.message.sent` | `chat` | `conversation_id, recipient_id, text, agent_type (human/bot)` |
| **Marketing** | `fb_leads` | INSERT | `marketing.lead.generated` | `marketing` | `lead_id, campaign_id, form_id, telefono, email, nombre` |
| **Marketing** | `gastos_publicidad` | INSERT / UPDATE | `marketing.ad.expense` | `marketing` | `campaign_id, date, amount, platform (meta/tiktok), currency` |
| **Marketing** | `post_queue` | UPDATE a 'posted' | `marketing.post.published` | `marketing` | `post_id, template_id, fb_post_id, posted_at, sku` |
| **Proveedores** | `proveedores` | INSERT | `supplier.created` | `supplier` | `supplier_id, name, contact_phone, categories` |
| **Proveedores** | `licitaciones` | INSERT | `purchase.requested` | `supplier` | `licitacion_id, sku, target_qty, target_unit_price` |
| **Proveedores** | `licitacion_proveedores` | INSERT / UPDATE | `supplier.bid.received` | `supplier` | `bid_id, licitacion_id, supplier_id, unit_price, lead_time_days` |
| **Proveedores** | `licitacion_proveedores` | UPDATE estado='ganador' | `supplier.selected` | `supplier` | `bid_id, licitacion_id, supplier_id, total_amount` |
| **Finanzas** | Projector (consumidor) | Consume `order.delivered` | `finance.income.created` | `finance` | `transaction_id, order_id, amount, account, date` |
| **Finanzas** | Projector (consumidor) | Consume `marketing.ad.expense` | `finance.expense.created` | `finance` | `transaction_id, expense_type, amount, date` |

---

## 3. Estado de whatsapp_orders (Panel actual vs Event Map)

En el panel actual (`src/pages/Pedidos.tsx`), los estados del tablero Kanban son:
1. `nuevo` → emite `order.created`
2. `por_empacar` → emite `order.confirmed`
3. `en_camino` → emite `order.shipped`
4. `entregado` → emite `order.delivered`
5. `cancelado` → emite `order.cancelled`

Compatibilidad con legados:
- `confirmado` → `order.confirmed`
- `enviado` → `order.shipped`
- `cancelada` → `order.cancelled`

---

## 4. Consumidores Planificados (Fases 6-8)

1. **Finance Projector** (`os.event_consumers: 'finance_projector'`):
   - Escucha `order.delivered`, `marketing.ad.expense`, `purchase.requested`.
   - Proyecta en: `finance.money_transactions`, `finance.cash_accounts`, `finance.daily_metrics`.
   - *Nota:* Finanzas solo consume eventos, nunca genera eventos directamente para evitar bucles.

2. **OS Memory** (`os.event_consumers: 'os_memory'`):
   - Agrega snapshots diarios y hechos históricos (`memory.facts`, `memory.daily_snapshots`, `memory.insights`).
   - Evita recomputar queries pesadas en vivo.

3. **Intelligence Layer (Copilot / Agentes)**:
   - Consulta el flujo de eventos e índices de atribución (e.g. `codigo_anuncio` -> `order.created` -> `order.delivered`).
   - Responde preguntas ejecutivas: *"¿Qué anuncio trae clientes que realmente compran?"*, *"¿Por qué bajó la utilidad hoy?"*.
