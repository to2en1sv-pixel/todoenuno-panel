import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
  Plus,
  Save,
  Trash2,
  FileText,
  CheckCircle2,
  Clock,
  LayoutList,
  Search,
  Eye,
  Pencil,
  Columns2,
  Copy,
  Check,
  Download,
  Map,
  Database,
  Bot,
  Sparkles,
  ExternalLink,
  RotateCcw,
  ChevronLeft,
  AlertCircle,
  ArrowRight,
  ListChecks,
} from 'lucide-react';

type DocStatus = 'Pendiente' | 'En Progreso' | 'Completado';
type DocCategory = 'General' | 'Roadmap' | 'Bot Todd' | 'SQL & Infra' | 'Operación' | 'Fase' | 'Idea';

type Doc = {
  id: string;
  titulo: string;
  contenido: string;
  categoria: string;
  estado: string;
  updated_at: string;
  isStarter?: boolean;
};

type RoadmapMilestone = {
  id: string;
  fase: string;
  titulo: string;
  descripcion: string;
  estado: DocStatus;
  moduloRuta?: string;
  moduloLabel?: string;
  sqlFile?: string;
  entregables: string[];
};

const LOCAL_DOCS_KEY = 'todoenuno_panel_docs_v2';
const LOCAL_ROADMAP_KEY = 'todoenuno_roadmap_milestones_v2';
const ROADMAP_SYNC_DOC_TITLE = '__SYSTEM_ROADMAP_STATE_V2__';

const DEFAULT_ROADMAP_MILESTONES: RoadmapMilestone[] = [
  {
    id: 'ms-s1',
    fase: 'Sprint 1',
    titulo: 'OS Event Store & Event Stream',
    descripcion: 'Bus unificado de eventos operativos (schema os.events) y monitor LIVE.',
    estado: 'Completado',
    moduloRuta: '/event-stream',
    moduloLabel: 'OS Brain & Events',
    sqlFile: 'docs/20261107_sprint1_os_event_store.sql',
    entregables: [
      'Tablas os.events, event_types y event_consumers',
      'Stream LIVE en tiempo real y mapa de arquitectura',
    ],
  },
  {
    id: 'ms-s2',
    fase: 'Sprint 2',
    titulo: 'Money Engine & Finanzas + Pauta Meta',
    descripcion: 'Proyector financiero automático al entregar pedidos y registro de gasto publicitario.',
    estado: 'Completado',
    moduloRuta: '/finanzas',
    moduloLabel: 'Finanzas & Budget',
    sqlFile: 'docs/20261107_sprint2_money_engine.sql',
    entregables: [
      'Liquidación de ingresos COD en caja al entregar',
      'Atribución de gastos publicitarios y ROAS real',
    ],
  },
  {
    id: 'ms-s3',
    fase: 'Sprint 3–6',
    titulo: 'Catálogo Visual, Variantes (Color/Talla) & Kárdex',
    descripcion: 'Control real de bodega, SKU padre/variantes sincronizado con pedidos y rentabilidad.',
    estado: 'Completado',
    moduloRuta: '/catalogo',
    moduloLabel: 'Catálogo Visual',
    sqlFile: 'docs/20261112_sprint10_catalog_inventory_fix.sql',
    entregables: [
      'Variantes color/talla/stock en productos_variantes',
      'Descuento y devolución de stock automático por pedido',
    ],
  },
  {
    id: 'ms-s7',
    fase: 'Sprint 7–8',
    titulo: 'Pedidos Pro, Encargos Programados & Lista Negra DICOM',
    descripcion: 'Kanban COD por fase, encargos futuros y semáforo antifraude por teléfono.',
    estado: 'Completado',
    moduloRuta: '/pedidos',
    moduloLabel: 'Pedidos',
    sqlFile: 'docs/20261110_sprint8_lista_negra_dicom.sql',
    entregables: [
      'Score antifraude automático (pedidos entregados vs cancelados)',
      'Boletinaje y rehabilitación en client_blacklist',
    ],
  },
  {
    id: 'ms-evo',
    fase: 'Sprint 12',
    titulo: 'UniChat Evolution API v2.3.7 (Suite COD)',
    descripcion: 'Migración total de BuilderBot hacia Evolution API con multimedia y cierre directo.',
    estado: 'Completado',
    moduloRuta: '/unichat',
    moduloLabel: 'UniChat',
    entregables: [
      'Webhook /api/evolution-webhook con resolución @lid y Meta Ads',
      'Envío de fotos del catálogo + variantes y carga de audios/imágenes',
      'Crear Pedido pre-llenado, atajos / y ficha antifraude lateral',
    ],
  },
  {
    id: 'ms-todd',
    fase: 'Sprint 13',
    titulo: 'Bot Todd v2 Híbrido (OpenAI + n8n + Panel Bridge)',
    descripcion: 'Asistente IA híbrido que responde dudas abiertas, envía fotos por SKU y crea pedidos reales.',
    estado: 'Completado',
    moduloRuta: '/unichat',
    moduloLabel: 'Probar en UniChat',
    entregables: [
      'Puente automático desde /api/evolution-webhook respetando Modo Humano',
      'Contexto único en /api/todd-bridge (catálogo, variantes, antifraude, estado)',
      'Creación automática en whatsapp_orders + evento OS Brain',
    ],
  },
  {
    id: 'ms-next-1',
    fase: 'Próximo · Fase A',
    titulo: 'Recuperación de Carritos Abandonados por Bot Todd',
    descripcion: 'Si un cliente cotiza o deja datos a medias y no responde en 2–4 horas, enviar follow-up amable automático.',
    estado: 'En Progreso',
    moduloRuta: '/cola',
    moduloLabel: 'Cola & Seguimiento',
    entregables: [
      'Cron/n8n revisando whatsapp_state en pasos cotizando/esperando_* > 2h',
      'Respetar status !== "human" y no recontactar pedidos ya cerrados',
    ],
  },
  {
    id: 'ms-next-2',
    fase: 'Próximo · Fase B',
    titulo: 'Pedidos Multi-Producto & Cálculo Automático de Envío',
    descripcion: 'Permitir que Bot Todd cierre 2+ productos distintos o combos y sume tarifa de envío por departamento.',
    estado: 'Pendiente',
    moduloRuta: '/marketing',
    moduloLabel: 'Pricing & Promo',
    entregables: [
      'Soporte de arreglo items[] múltiple en /api/todd-bridge create_order',
      'Tabla de tarifas de envío por zona (San Salvador vs Departamentos)',
    ],
  },
  {
    id: 'ms-next-3',
    fase: 'Próximo · Fase C',
    titulo: 'Audios de Voz (Whisper) + Liquidación Automática Motoristas',
    descripcion: 'Transcribir notas de voz de WhatsApp para que Todd las entienda y cuadre diario por ruta.',
    estado: 'Pendiente',
    moduloRuta: '/rentabilidad',
    moduloLabel: 'Rentabilidad',
    entregables: [
      'Transcripción vía OpenAI Whisper cuando Evolution envíe audioMessage',
      'Resumen diario de cobros en efectivo por motorista vs Finanzas',
    ],
  },
];

const STARTER_DOCS: Doc[] = [
  {
    id: 'starter-todd-evo',
    titulo: 'Guía Maestra: Bot Todd v2 + Evolution 2.3.7 + UniChat',
    categoria: 'Bot Todd',
    estado: 'Completado',
    isStarter: true,
    updated_at: new Date().toISOString(),
    contenido: `# BOT TODD v2 + EVOLUTION API 2.3.7 + UNICHAT

## 1. Arquitectura en Producción
1. **WhatsApp → Evolution API (VPS :8080, instancia \`eee\`)** recibe mensajes y los envía al webhook único:
   \`https://todoenuno-panel.vercel.app/api/evolution-webhook\`
2. **Panel Webhook (\`/api/evolution-webhook\`)**:
   - Resuelve IDs ocultos \`@lid\` usando \`remoteJidAlt\` / \`senderPn\`.
   - Captura atribución de anuncios de Meta (\`externalAdReply\`) en \`whatsapp_state.last_detalle\`.
   - Guarda conversación/mensajes en Supabase (\`bb_conversations\`, \`bb_messages\`) para **UniChat**.
   - **Solo si** \`fromMe === false\` **y** \`status !== 'human'\`, reenvía el evento a \`N8N_TODD_WEBHOOK_URL\`.
3. **n8n (Workflow "Todd v2 - Hibrido OpenAI + UniChat")**:
   - Pide el contexto completo en **1 llamada** a \`POST /api/todd-bridge\` (\`action: "context"\`).
   - OpenAI (\`gpt-4o-mini\`, JSON estructurado) responde dudas usando el catálogo vivo, variantes y reglas antifraude.
   - Envía texto o foto por SKU mediante \`POST /api/send-message\` con \`pauseBot: false\`.
   - Al reunir nombre, dirección, departamento y pago confirmado, llama a \`POST /api/todd-bridge\` (\`action: "create_order"\`).

## 2. Variables de Entorno en Vercel
- \`VITE_SUPABASE_URL\` / \`VITE_SUPABASE_ANON_KEY\`
- \`SUPABASE_URL\` / \`SUPABASE_SERVICE_ROLE_KEY\`
- \`EVOLUTION_API_URL\` (ej. \`http://67.205.174.134:8080\`)
- \`EVOLUTION_API_KEY\` (API Key global o de instancia \`eee\`)
- \`EVOLUTION_INSTANCE=eee\`
- \`N8N_TODD_WEBHOOK_URL\` (Production URL del webhook \`/webhook/todd-v2\` en n8n)
- \`TODD_INTERNAL_SECRET\` (opcional; si se configura en Vercel, añadir header \`x-todd-secret\` en n8n)

## 3. Cómo recuperar la API Key de Evolution si la olvidas
- **Opción rápida:** Vercel → Project Settings → Environment Variables → ver \`EVOLUTION_API_KEY\`.
- **Directo en el VPS por SSH:**
  \`\`\`bash
  docker ps
  docker inspect NOMBRE_CONTENEDOR | grep -i AUTHENTICATION_API_KEY
  \`\`\`

## 4. Diagnóstico en 1 clic
- Verificar conexión y variables de Vercel: \`GET /api/evolution-webhook\`
- Descargar JSON limpio de Todd v2 para n8n: \`GET /api/todd-bridge?action=workflow\``,
  },
  {
    id: 'starter-roadmap-8',
    titulo: 'Arquitectura: Núcleo TODOENUNO OS (Fases 0–8)',
    categoria: 'Roadmap',
    estado: 'Completado',
    isStarter: true,
    updated_at: new Date().toISOString(),
    contenido: `# TODOENUNO OS — NÚCLEO DE EVENTOS Y MÓDULOS

Principio Rector:
**"No construyamos OS Events como una tabla. Construyámoslo como el núcleo de TodoEnUno OS."**

## Ciclo de Vida Unificado
1. Cliente escribió (\`chat.message.received\`)
2. Lead generado / Ad Tag detectado (\`lead.generated\`)
3. Pedido creado por UniChat o Bot Todd (\`order.created\`)
4. Pedido confirmado / empacado (\`order.confirmed\`)
5. Pedido despachado con motorista (\`order.shipped\`)
6. Pedido entregado (\`order.delivered\`)
7. Dinero cobrado y liquidado en Finanzas (\`finance.income.created\`)

## Estado de las 8 Fases Core
- [x] FASE 0: Auditoría y Congelación (\`docs/os-events-map.md\`)
- [x] FASE 1: OS Event Store (\`os.events\`, \`os.event_types\`, \`os.event_consumers\`)
- [x] FASE 2: Lenguaje Único de Eventos (\`order.*\`, \`chat.*\`, \`marketing.*\`, \`supplier.*\`)
- [x] FASE 3: Order Event Producer (Pedidos Kanban + Bot Todd)
- [x] FASE 4: Marketing Event Producer (gastos Meta, ROAS, cola de posts)
- [x] FASE 5: Proveedores & Licitaciones
- [x] FASE 6: Money Engine (proyección automática en Finanzas)
- [x] FASE 7: Catálogo Visual + Variantes Color/Talla + Kárdex real
- [x] FASE 8: Capa IA Operativa (Bot Todd v2 Híbrido + OpenAI + UniChat)`,
  },
  {
    id: 'starter-sql-index',
    titulo: 'Índice de Migraciones SQL en Supabase (/docs)',
    categoria: 'SQL & Infra',
    estado: 'Completado',
    isStarter: true,
    updated_at: new Date().toISOString(),
    contenido: `# ÍNDICE DE SCRIPTS SQL DEL REPOSITORIO (/docs)

Orden cronológico de scripts disponibles en la carpeta \`/docs\`:

1. \`20261107_sprint1_os_event_store.sql\` — Schema \`os\`, tablas \`events\`, \`event_types\`, \`event_consumers\`.
2. \`20261107_sprint2_money_engine.sql\` — Motor financiero y proyección de ingresos/egresos.
3. \`20261107_sprint2_pauta_trigger.sql\` — Trigger automático de gastos de pauta publicitaria.
4. \`20261107_sprint3_inventory_kardex.sql\` — Inventario maestro, movimientos de Kárdex y stock reservado.
5. \`20261108_sprint3_todd_bot_catalog.sql\` — Columnas de pitch, keywords e instrucciones de Bot Todd.
6. \`20261108_sprint4_pedidos_pro.sql\` — Mejoras de gestión de órdenes y estados logísticos.
7. \`20261108_sprint5_proveedores_licitaciones.sql\` — Tablas de proveedores y cotizaciones.
8. \`20261108_sprint6_catalogo_pedidos_rentabilidad.sql\` — Unión de catálogo, alias de atribución y rentabilidad.
9. \`20261109_sprint7_pedidos_encargos_programados.sql\` — Encargos programados y fecha de despacho.
10. \`20261110_sprint8_lista_negra_dicom.sql\` — Tabla \`client_blacklist\` y evaluación antifraude.
11. \`20261111_sprint9_os_events_complete_catalog.sql\` — Catálogo completo de eventos del sistema.
12. \`20261112_sprint10_catalog_inventory_fix.sql\` — Sincronización de \`productos_variantes\` e \`inventory_stock\`.
13. \`20261112_sprint11_reset_cero_odoo.sql\` — Limpieza y arranque limpio de inventario sin Odoo.`,
  },
  {
    id: 'starter-cod-playbook',
    titulo: 'Playbook Diario: Operación UniChat, Lista Negra y @lid',
    categoria: 'Operación',
    estado: 'Completado',
    isStarter: true,
    updated_at: new Date().toISOString(),
    contenido: `# PLAYBOOK DIARIO — UNICHAT Y CONTROL ANTIFRAUDE

## Atención en UniChat
- Usa el filtro **Sin resp.** para priorizar clientes cuyo último mensaje espera respuesta.
- Usa \`/\` en la caja de texto (ej. \`/datos\`, \`/envios\`, \`/transferencia\`) para responder en 1 segundo.
- Usa el ícono **📎 Clip** para enviar ficha + foto + variantes reales de un producto directamente desde Catálogo Visual.
- Si respondes manualmente o presionas **Pausar**, Todd pasa a **Modo Humano** y no interfiere.

## Manejo de IDs @lid de WhatsApp
- Algunos clientes escriben desde cuentas con privacidad Meta (\`@lid\`).
- El webhook intenta resolver el teléfono real vía \`remoteJidAlt\`/\`senderPn\`.
- Si aún aparece como \`WhatsApp LID (...)\` y el cliente te escribe su número, haz clic en el **lápiz ✏️** junto a su nombre en el header del chat para guardar el teléfono de 8 dígitos.

## Semáforo Antifraude
- **Verde:** Cliente con entregas previas exitosas.
- **Amarillo (Score 50):** Cliente nuevo; confirmar dirección exacta y punto de referencia.
- **Rojo:** Cancelaciones previas o en **Lista Negra**; exigir transferencia anticipada antes de despachar.`,
  },
];

function isStarterId(id: string): boolean {
  return id.startsWith('starter-') || id.startsWith('local-');
}

function loadLocalDocs(): Doc[] {
  try {
    const raw = localStorage.getItem(LOCAL_DOCS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return STARTER_DOCS;
}

function saveLocalDocs(items: Doc[]) {
  try {
    localStorage.setItem(LOCAL_DOCS_KEY, JSON.stringify(items));
  } catch {}
}

function loadLocalRoadmap(): RoadmapMilestone[] {
  try {
    const raw = localStorage.getItem(LOCAL_ROADMAP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_ROADMAP_MILESTONES;
}

function saveLocalRoadmap(items: RoadmapMilestone[]) {
  try {
    localStorage.setItem(LOCAL_ROADMAP_KEY, JSON.stringify(items));
  } catch {}
}

function renderInlineFormatting(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx} className="font-bold text-[var(--tx)]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={idx} className="px-1.5 py-0.5 rounded bg-sf border border-[var(--bd)] font-mono text-[11px] text-indigo-500">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function MarkdownPreview({ content }: { content: string }) {
  const lines = (content || '').split('\n');
  const elements: JSX.Element[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  lines.forEach((line, idx) => {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${idx}`}
            className="my-2 p-3 rounded-xl bg-sf border border-[var(--bd)] overflow-x-auto text-[11px] font-mono leading-relaxed"
          >
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      elements.push(<div key={`sp-${idx}`} className="h-2" />);
      return;
    }

    if (trimmed.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${idx}`} className="text-sm font-bold mt-4 mb-1 text-[var(--tx)]">
          {renderInlineFormatting(trimmed.slice(4))}
        </h3>
      );
      return;
    }

    if (trimmed.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${idx}`} className="text-base font-black mt-5 mb-1.5 pb-1 border-b border-[var(--bd)] text-[var(--tx)]">
          {renderInlineFormatting(trimmed.slice(3))}
        </h2>
      );
      return;
    }

    if (trimmed.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${idx}`} className="text-lg font-black mt-1 mb-2 text-[var(--tx)]">
          {renderInlineFormatting(trimmed.slice(2))}
        </h1>
      );
      return;
    }

    if (trimmed.startsWith('- [x] ') || trimmed.startsWith('- [X] ')) {
      elements.push(
        <div key={`chk-ok-${idx}`} className="flex items-start gap-2 text-xs py-0.5 leading-relaxed">
          <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
          <span>{renderInlineFormatting(trimmed.slice(6))}</span>
        </div>
      );
      return;
    }

    if (trimmed.startsWith('- [ ] ')) {
      elements.push(
        <div key={`chk-no-${idx}`} className="flex items-start gap-2 text-xs py-0.5 leading-relaxed">
          <Clock size={14} className="text-amber-500 mt-0.5 shrink-0" />
          <span>{renderInlineFormatting(trimmed.slice(6))}</span>
        </div>
      );
      return;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <div key={`li-${idx}`} className="flex items-start gap-2 text-xs py-0.5 pl-1 leading-relaxed">
          <span className="text-indigo-500 font-bold">•</span>
          <span>{renderInlineFormatting(trimmed.slice(2))}</span>
        </div>
      );
      return;
    }

    const numMatch = trimmed.match(/^(\d+\.)\s+([\s\S]+)$/);
    if (numMatch) {
      elements.push(
        <div key={`num-${idx}`} className="flex items-start gap-2 text-xs py-0.5 pl-1 leading-relaxed">
          <span className="font-mono font-bold text-indigo-500 shrink-0">{numMatch[1]}</span>
          <span>{renderInlineFormatting(numMatch[2])}</span>
        </div>
      );
      return;
    }

    elements.push(
      <p key={`p-${idx}`} className="text-xs leading-relaxed tx-mu">
        {renderInlineFormatting(line)}
      </p>
    );
  });

  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre key="code-end" className="my-2 p-3 rounded-xl bg-sf border border-[var(--bd)] overflow-x-auto text-[11px] font-mono">
        <code>{codeLines.join('\n')}</code>
      </pre>
    );
  }

  return <div className="space-y-0.5">{elements}</div>;
}

export function DocsPage() {
  const [activeTab, setActiveTab] = useState<'docs' | 'roadmap'>('docs');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbMode, setDbMode] = useState<'supabase' | 'local'>('supabase');
  const [isSaving, setIsSaving] = useState(false);

  // Estado editor
  const [titulo, setTitulo] = useState('');
  const [contenido, setContenido] = useState('');
  const [categoria, setCategoria] = useState('General');
  const [estado, setEstado] = useState('En Progreso');
  const [viewMode, setViewMode] = useState<'edit' | 'split' | 'preview'>('split');
  const [mobileShowEditor, setMobileShowEditor] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Búsqueda y filtros
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('Todas');
  const [filterStatus, setFilterStatus] = useState('Todos');

  // Notificación inline
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Estado del Tablero Roadmap
  const [milestones, setMilestones] = useState<RoadmapMilestone[]>(loadLocalRoadmap);
  const [roadmapDocId, setRoadmapDocId] = useState<string | null>(null);
  const [roadmapFilter, setRoadmapFilter] = useState<'Todos' | DocStatus>('Todos');
  const [showNewMilestone, setShowNewMilestone] = useState(false);
  const [msFase, setMsFase] = useState('');
  const [msTitulo, setMsTitulo] = useState('');
  const [msDesc, setMsDesc] = useState('');
  const [msEstado, setMsEstado] = useState<DocStatus>('Pendiente');
  const [msEntregables, setMsEntregables] = useState('');

  const showBanner = (type: 'ok' | 'err', text: string) => {
    setBanner({ type, text });
    setTimeout(() => {
      setBanner(prev => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const selectDocument = useCallback((doc: Doc) => {
    setSelectedDoc(doc);
    setTitulo(doc.titulo);
    setContenido(doc.contenido);
    setCategoria(doc.categoria || 'General');
    setEstado(doc.estado || 'En Progreso');
    setConfirmDeleteId(null);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('panel_docs')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      const allRows = (data || []) as Doc[];
      const roadmapStateDoc = allRows.find(d => d.titulo === ROADMAP_SYNC_DOC_TITLE);
      if (roadmapStateDoc) {
        setRoadmapDocId(roadmapStateDoc.id);
        try {
          const parsedMs = JSON.parse(roadmapStateDoc.contenido);
          if (Array.isArray(parsedMs) && parsedMs.length > 0) {
            setMilestones(parsedMs);
            saveLocalRoadmap(parsedMs);
          }
        } catch {}
      }

      const visibleDbDocs = allRows.filter(
        d => d.titulo !== ROADMAP_SYNC_DOC_TITLE && !d.titulo.startsWith('__SYSTEM_')
      );
      const dbTitles = new Set(visibleDbDocs.map(d => d.titulo.trim().toLowerCase()));
      const mergedDocs = [
        ...visibleDbDocs,
        ...STARTER_DOCS.filter(s => !dbTitles.has(s.titulo.trim().toLowerCase())),
      ];

      setDbMode('supabase');
      setDocs(mergedDocs);
      saveLocalDocs(mergedDocs);
      if (mergedDocs.length > 0) {
        selectDocument(mergedDocs[0]);
      }
    } catch {
      const fallbackDocs = loadLocalDocs();
      setDbMode('local');
      setDocs(fallbackDocs);
      if (fallbackDocs.length > 0) {
        selectDocument(fallbackDocs[0]);
      }
    } finally {
      setLoading(false);
    }
  }, [selectDocument]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedDoc) return false;
    return (
      titulo !== selectedDoc.titulo ||
      contenido !== selectedDoc.contenido ||
      categoria !== (selectedDoc.categoria || 'General') ||
      estado !== (selectedDoc.estado || 'En Progreso')
    );
  }, [selectedDoc, titulo, contenido, categoria, estado]);

  const handleCreate = async () => {
    const newDraft = {
      titulo: 'Nuevo Documento',
      contenido: '# Nuevo Documento\n\nDescribe aquí el objetivo, pasos o notas técnicas...\n\n- [ ] Primer paso\n',
      categoria: 'General',
      estado: 'Pendiente',
      updated_at: new Date().toISOString(),
    };

    if (dbMode === 'supabase') {
      const { data, error } = await supabase.from('panel_docs').insert(newDraft).select();
      if (!error && data && data[0]) {
        const created = data[0] as Doc;
        const next = [created, ...docs];
        setDocs(next);
        saveLocalDocs(next);
        selectDocument(created);
        setMobileShowEditor(true);
        showBanner('ok', 'Documento creado en Supabase.');
        return;
      }
    }

    const localCreated: Doc = { id: `local-${Date.now()}`, ...newDraft };
    const next = [localCreated, ...docs];
    setDocs(next);
    saveLocalDocs(next);
    selectDocument(localCreated);
    setMobileShowEditor(true);
    showBanner('ok', 'Documento creado localmente.');
  };

  const handleSave = useCallback(async () => {
    if (!selectedDoc || isSaving) return;
    setIsSaving(true);
    const nowIso = new Date().toISOString();

    try {
      let savedDoc: Doc = {
        ...selectedDoc,
        titulo: titulo.trim() || 'Sin título',
        contenido,
        categoria,
        estado,
        updated_at: nowIso,
      };

      if (dbMode === 'supabase') {
        if (isStarterId(selectedDoc.id)) {
          // Si era una guía base o borrador local, la insertamos en Supabase por primera vez
          const { data, error } = await supabase
            .from('panel_docs')
            .insert({
              titulo: savedDoc.titulo,
              contenido: savedDoc.contenido,
              categoria: savedDoc.categoria,
              estado: savedDoc.estado,
              updated_at: nowIso,
            })
            .select();

          if (error) throw error;
          if (data && data[0]) {
            savedDoc = data[0] as Doc;
          }
        } else {
          const { error } = await supabase
            .from('panel_docs')
            .update({
              titulo: savedDoc.titulo,
              contenido: savedDoc.contenido,
              categoria: savedDoc.categoria,
              estado: savedDoc.estado,
              updated_at: nowIso,
            })
            .eq('id', selectedDoc.id);

          if (error) throw error;
        }
      }

      const nextDocs = docs
        .map(d => (d.id === selectedDoc.id ? savedDoc : d))
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

      setDocs(nextDocs);
      saveLocalDocs(nextDocs);
      setSelectedDoc(savedDoc);
      showBanner('ok', dbMode === 'supabase' ? 'Cambios guardados en Supabase.' : 'Cambios guardados localmente.');
    } catch (err: any) {
      // Fallback local para no perder trabajo del usuario
      const nextDocs = docs.map(d =>
        d.id === selectedDoc.id
          ? { ...d, titulo: titulo.trim() || 'Sin título', contenido, categoria, estado, updated_at: nowIso }
          : d
      );
      setDocs(nextDocs);
      saveLocalDocs(nextDocs);
      showBanner('err', `Guardado en respaldo local (Supabase: ${err?.message || 'sin tabla panel_docs'}).`);
    } finally {
      setIsSaving(false);
    }
  }, [selectedDoc, isSaving, titulo, contenido, categoria, estado, dbMode, docs]);

  // Atajo Ctrl+S / Cmd+S
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && activeTab === 'docs' && selectedDoc) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, selectedDoc, handleSave]);

  const handleDelete = async (id: string) => {
    if (dbMode === 'supabase' && !isStarterId(id)) {
      const { error } = await supabase.from('panel_docs').delete().eq('id', id);
      if (error) {
        showBanner('err', `No se pudo eliminar de Supabase: ${error.message}`);
        return;
      }
    }

    const remaining = docs.filter(d => d.id !== id);
    setDocs(remaining);
    saveLocalDocs(remaining);
    setConfirmDeleteId(null);

    if (selectedDoc?.id === id) {
      if (remaining.length > 0) selectDocument(remaining[0]);
      else {
        setSelectedDoc(null);
        setTitulo('');
        setContenido('');
      }
    }
    showBanner('ok', 'Documento eliminado.');
  };

  const handleRestoreGuides = () => {
    const existingTitles = new Set(docs.map(d => d.titulo.trim().toLowerCase()));
    const missing = STARTER_DOCS.filter(s => !existingTitles.has(s.titulo.trim().toLowerCase()));
    if (missing.length === 0) {
      showBanner('ok', 'Todas las guías actualizadas del sistema ya están cargadas.');
      return;
    }
    const next = [...missing, ...docs];
    setDocs(next);
    saveLocalDocs(next);
    selectDocument(missing[0]);
    showBanner('ok', `Se restauraron ${missing.length} guías actualizadas del sistema.`);
  };

  const handleCopyDoc = async () => {
    if (!selectedDoc) return;
    try {
      await navigator.clipboard.writeText(`# ${titulo}\n\n${contenido}`);
      setCopiedId(selectedDoc.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      showBanner('err', 'No se pudo copiar al portapapeles.');
    }
  };

  const handleDownloadMarkdown = () => {
    if (!selectedDoc) return;
    const slug = (titulo || 'documento').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const blob = new Blob([`# ${titulo}\n\n${contenido}`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'documento'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const insertSnippet = (snippet: string) => {
    setContenido(prev => (prev ? `${prev}\n${snippet}` : snippet));
  };

  // Persistencia de Roadmap
  const persistMilestones = async (next: RoadmapMilestone[]) => {
    setMilestones(next);
    saveLocalRoadmap(next);
    if (dbMode === 'supabase') {
      try {
        const payload = {
          titulo: ROADMAP_SYNC_DOC_TITLE,
          contenido: JSON.stringify(next),
          categoria: 'Roadmap',
          estado: 'En Progreso',
          updated_at: new Date().toISOString(),
        };
        if (roadmapDocId) {
          await supabase.from('panel_docs').update(payload).eq('id', roadmapDocId);
        } else {
          const { data } = await supabase.from('panel_docs').insert(payload).select();
          if (data && data[0]) setRoadmapDocId(data[0].id);
        }
      } catch {}
    }
  };

  const handleCycleMilestoneStatus = async (id: string) => {
    const order: DocStatus[] = ['Pendiente', 'En Progreso', 'Completado'];
    const next = milestones.map(m => {
      if (m.id !== id) return m;
      const idx = order.indexOf(m.estado);
      const nextStatus = order[(idx + 1) % order.length];
      return { ...m, estado: nextStatus };
    });
    await persistMilestones(next);
  };

  const handleAddMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msTitulo.trim()) return;
    const newItem: RoadmapMilestone = {
      id: `ms-custom-${Date.now()}`,
      fase: msFase.trim() || 'Nueva Fase',
      titulo: msTitulo.trim(),
      descripcion: msDesc.trim() || 'Iniciativa operativa agregada desde Docs & Roadmap.',
      estado: msEstado,
      entregables: msEntregables
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean),
    };
    const next = [...milestones, newItem];
    await persistMilestones(next);
    setShowNewMilestone(false);
    setMsFase('');
    setMsTitulo('');
    setMsDesc('');
    setMsEntregables('');
    showBanner('ok', 'Hito agregado al Roadmap.');
  };

  const handleDeleteMilestone = async (id: string) => {
    const next = milestones.filter(m => m.id !== id);
    await persistMilestones(next);
    showBanner('ok', 'Hito eliminado del Roadmap.');
  };

  const handleResetRoadmap = async () => {
    await persistMilestones(DEFAULT_ROADMAP_MILESTONES);
    showBanner('ok', 'Roadmap sincronizado con las fases oficiales del panel.');
  };

  // Filtros de Documentos
  const filteredDocs = useMemo(() => {
    return docs.filter(d => {
      if (filterCat !== 'Todas' && d.categoria !== filterCat) return false;
      if (filterStatus !== 'Todos' && d.estado !== filterStatus) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return (
        d.titulo.toLowerCase().includes(q) ||
        d.contenido.toLowerCase().includes(q) ||
        d.categoria.toLowerCase().includes(q)
      );
    });
  }, [docs, filterCat, filterStatus, search]);

  const categories = useMemo(() => {
    const base = ['Todas', 'Bot Todd', 'Roadmap', 'SQL & Infra', 'Operación', 'Fase', 'Idea', 'General'];
    docs.forEach(d => {
      if (d.categoria && !base.includes(d.categoria)) base.push(d.categoria);
    });
    return base;
  }, [docs]);

  // Métricas de Roadmap
  const roadmapStats = useMemo(() => {
    const total = milestones.length;
    const completed = milestones.filter(m => m.estado === 'Completado').length;
    const inProgress = milestones.filter(m => m.estado === 'En Progreso').length;
    const pending = milestones.filter(m => m.estado === 'Pendiente').length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, pending, pct };
  }, [milestones]);

  const filteredMilestones = useMemo(() => {
    if (roadmapFilter === 'Todos') return milestones;
    return milestones.filter(m => m.estado === roadmapFilter);
  }, [milestones, roadmapFilter]);

  const getStatusBadge = (status: string) => {
    if (status === 'Completado') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 size={11} /> Completado
        </span>
      );
    }
    if (status === 'En Progreso') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          <Clock size={11} /> En Progreso
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sf tx-mu border border-[var(--bd)]">
        <LayoutList size={11} /> Pendiente
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-3 h-[calc(100dvh-96px)] lg:h-[calc(100dvh-48px)] min-h-[540px] w-full min-w-0">
      {/* Header Superior + Navegación de Pestañas */}
      <div className="bg-cd bd rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 shrink-0">
            <FileText size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-black text-base tracking-tight">Docs & Roadmap OS</h1>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  dbMode === 'supabase'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                }`}
              >
                {dbMode === 'supabase' ? 'Supabase DB' : 'Respaldo Local'}
              </span>
            </div>
            <p className="text-[11px] tx-mu truncate">
              Playbooks operativos, guías de Bot Todd / Evolution 2.3.7, migraciones SQL y progreso por Sprint.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex p-1 bg-sf rounded-xl border border-[var(--bd)] text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('docs')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'docs' ? 'bg-[var(--tx)] text-[var(--cd)]' : 'tx-mu hover:text-[var(--tx)]'
              }`}
            >
              <FileText size={13} /> Documentos ({docs.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('roadmap')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                activeTab === 'roadmap' ? 'bg-[var(--tx)] text-[var(--cd)]' : 'tx-mu hover:text-[var(--tx)]'
              }`}
            >
              <Map size={13} /> Roadmap ({roadmapStats.pct}%)
            </button>
          </div>

          <a
            href="/api/todd-bridge?action=workflow"
            download="todd-v2-workflow.json"
            className="px-3 py-1.5 rounded-xl border border-[var(--bd)] bg-sf hover:border-indigo-500 text-xs font-bold flex items-center gap-1.5 transition-colors"
            title="Descargar workflow híbrido de Bot Todd v2 para n8n"
          >
            <Bot size={14} className="text-purple-500" />
            <span className="hidden sm:inline">Workflow Todd n8n</span>
            <Download size={12} className="opacity-70" />
          </a>
        </div>
      </div>

      {/* Banner de feedback */}
      {banner && (
        <div
          className={`px-4 py-2 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 shrink-0 ${
            banner.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-500'
          }`}
        >
          <span className="flex items-center gap-2">
            {banner.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {banner.text}
          </span>
          <button type="button" onClick={() => setBanner(null)} className="opacity-70 hover:opacity-100 text-[11px]">
            ✕
          </button>
        </div>
      )}

      {/* ==================== TAB 1: DOCUMENTOS & EDITOR ==================== */}
      {activeTab === 'docs' ? (
        <div className="flex-1 min-h-0 min-w-0 bg-cd bd rounded-2xl overflow-hidden flex flex-col lg:flex-row shadow-sm">
          {/* Sidebar de Documentos */}
          <div
            className={`w-full lg:w-[310px] xl:w-[330px] shrink-0 border-r border-[var(--bd)] flex-col bg-sf min-h-0 ${
              mobileShowEditor ? 'hidden lg:flex' : 'flex flex-1 lg:flex-none'
            }`}
          >
            <div className="p-3 border-b border-[var(--bd)] bg-cd space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-wider tx-mu">Biblioteca</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleRestoreGuides}
                    title="Restaurar guías oficiales del panel"
                    className="p-1.5 rounded-lg border border-[var(--bd)] bg-sf tx-mu hover:text-[var(--tx)] transition-colors"
                  >
                    <RotateCcw size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    className="bg-[var(--tx)] text-[var(--cd)] px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 hover:opacity-90"
                  >
                    <Plus size={14} /> Nuevo
                  </button>
                </div>
              </div>

              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 tx-mu" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar guía, SQL, variable..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-sf border border-[var(--bd)] text-xs outline-none focus:border-[var(--ac)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={filterCat}
                  onChange={e => setFilterCat(e.target.value)}
                  className="bg-sf border border-[var(--bd)] rounded-lg px-2 py-1 text-[11px] font-semibold outline-none"
                >
                  {categories.map(c => (
                    <option key={c} value={c}>
                      {c === 'Todas' ? 'Cat: Todas' : c}
                    </option>
                  ))}
                </select>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="bg-sf border border-[var(--bd)] rounded-lg px-2 py-1 text-[11px] font-semibold outline-none"
                >
                  <option value="Todos">Estado: Todos</option>
                  <option value="Completado">Completado</option>
                  <option value="En Progreso">En Progreso</option>
                  <option value="Pendiente">Pendiente</option>
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="p-5 text-xs text-center tx-mu">Cargando documentos...</div>
              )}

              {!loading &&
                filteredDocs.map(doc => {
                  const isSelected = selectedDoc?.id === doc.id;
                  const isConfirming = confirmDeleteId === doc.id;
                  return (
                    <div
                      key={doc.id}
                      onClick={() => {
                        selectDocument(doc);
                        setMobileShowEditor(true);
                      }}
                      className={`p-3 border-b border-[var(--bd)] cursor-pointer transition-colors group ${
                        isSelected ? 'bg-cd border-l-4 border-l-[var(--ac)]' : 'hover:bg-cd/60'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2 mb-1.5">
                        <span className="font-bold text-xs leading-snug line-clamp-2 text-[var(--tx)]">
                          {doc.titulo}
                        </span>
                        {isConfirming ? (
                          <div
                            className="flex items-center gap-1 shrink-0"
                            onClick={e => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => handleDelete(doc.id)}
                              className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold"
                            >
                              Borrar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-1.5 py-0.5 rounded bg-sf border border-[var(--bd)] text-[10px] font-bold"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setConfirmDeleteId(doc.id);
                            }}
                            className="text-rose-400 opacity-60 lg:opacity-0 group-hover:opacity-100 hover:text-rose-500 p-0.5 shrink-0"
                            title="Eliminar documento"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[10px] tx-mu">
                        <span className="font-semibold px-1.5 py-0.5 rounded bg-cd border border-[var(--bd)]">
                          {doc.categoria || 'General'}
                        </span>
                        {getStatusBadge(doc.estado)}
                      </div>
                    </div>
                  );
                })}

              {!loading && filteredDocs.length === 0 && (
                <div className="p-6 text-center text-xs tx-mu space-y-2">
                  <p>No hay documentos que coincidan con el filtro.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setFilterCat('Todas');
                      setFilterStatus('Todos');
                    }}
                    className="text-[var(--ac)] font-bold hover:underline"
                  >
                    Limpiar filtros
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Área de Editor / Vista Previa */}
          <div
            className={`flex-1 flex-col bg-cd min-h-0 min-w-0 ${
              mobileShowEditor ? 'flex' : 'hidden lg:flex'
            }`}
          >
            {selectedDoc ? (
              <>
                {/* Barra superior del documento */}
                <div className="p-3.5 border-b border-[var(--bd)] space-y-2.5 shrink-0">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMobileShowEditor(false)}
                      className="lg:hidden p-1.5 rounded-lg bg-sf border border-[var(--bd)] tx-mu"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <input
                      type="text"
                      value={titulo}
                      onChange={e => setTitulo(e.target.value)}
                      className="text-base sm:text-lg font-black bg-transparent outline-none flex-1 min-w-0 border-b border-transparent focus:border-[var(--ac)] transition-colors"
                      placeholder="Título del Documento"
                    />
                    {hasUnsavedChanges && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 shrink-0">
                        Sin guardar
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={categoria}
                        onChange={e => setCategoria(e.target.value)}
                        className="bg-sf border border-[var(--bd)] rounded-lg px-2 py-1 text-xs font-semibold outline-none"
                      >
                        <option value="General">General</option>
                        <option value="Bot Todd">Bot Todd</option>
                        <option value="Roadmap">Roadmap</option>
                        <option value="SQL & Infra">SQL & Infra</option>
                        <option value="Operación">Operación</option>
                        <option value="Fase">Fase</option>
                        <option value="Idea">Idea</option>
                      </select>

                      <select
                        value={estado}
                        onChange={e => setEstado(e.target.value)}
                        className="bg-sf border border-[var(--bd)] rounded-lg px-2 py-1 text-xs font-semibold outline-none"
                      >
                        <option value="Pendiente">Pendiente</option>
                        <option value="En Progreso">En Progreso</option>
                        <option value="Completado">Completado</option>
                      </select>

                      {/* Selector de modo Editar / Dividido / Vista Previa */}
                      <div className="flex p-0.5 bg-sf rounded-lg border border-[var(--bd)] text-[11px] font-bold">
                        <button
                          type="button"
                          onClick={() => setViewMode('edit')}
                          className={`px-2 py-1 rounded-md flex items-center gap-1 ${
                            viewMode === 'edit' ? 'bg-cd text-[var(--tx)] shadow-xs' : 'tx-mu'
                          }`}
                        >
                          <Pencil size={11} /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('split')}
                          className={`hidden md:flex px-2 py-1 rounded-md items-center gap-1 ${
                            viewMode === 'split' ? 'bg-cd text-[var(--tx)] shadow-xs' : 'tx-mu'
                          }`}
                        >
                          <Columns2 size={11} /> Dividido
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('preview')}
                          className={`px-2 py-1 rounded-md flex items-center gap-1 ${
                            viewMode === 'preview' ? 'bg-cd text-[var(--tx)] shadow-xs' : 'tx-mu'
                          }`}
                        >
                          <Eye size={11} /> Leer
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleCopyDoc}
                        className="p-1.5 rounded-lg border border-[var(--bd)] bg-sf tx-mu hover:text-[var(--tx)]"
                        title="Copiar contenido Markdown"
                      >
                        {copiedId === selectedDoc.id ? (
                          <Check size={14} className="text-emerald-500" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadMarkdown}
                        className="p-1.5 rounded-lg border border-[var(--bd)] bg-sf tx-mu hover:text-[var(--tx)]"
                        title="Descargar archivo .md"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-[var(--ac)] text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        <Save size={13} />
                        <span>{isSaving ? 'Guardando...' : 'Guardar (Ctrl+S)'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Barra rápida de Markdown (solo visible si se está editando) */}
                  {viewMode !== 'preview' && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pt-1 text-[10px] font-bold">
                      <span className="tx-mu shrink-0">Insertar:</span>
                      <button
                        type="button"
                        onClick={() => insertSnippet('## Nueva Sección')}
                        className="px-2 py-0.5 rounded bg-sf border border-[var(--bd)] hover:border-[var(--ac)] whitespace-nowrap"
                      >
                        ## Título
                      </button>
                      <button
                        type="button"
                        onClick={() => insertSnippet('- [ ] Tarea pendiente')}
                        className="px-2 py-0.5 rounded bg-sf border border-[var(--bd)] hover:border-[var(--ac)] whitespace-nowrap"
                      >
                        - [ ] Checklist
                      </button>
                      <button
                        type="button"
                        onClick={() => insertSnippet('```sql\n-- Tu consulta o comando aquí\n```')}
                        className="px-2 py-0.5 rounded bg-sf border border-[var(--bd)] hover:border-[var(--ac)] whitespace-nowrap"
                      >
                        {'</>'} Código / SQL
                      </button>
                    </div>
                  )}
                </div>

                {/* Cuerpo Editor + Vista Previa */}
                <div className="flex-1 min-h-0 flex overflow-hidden">
                  {viewMode !== 'preview' && (
                    <textarea
                      value={contenido}
                      onChange={e => setContenido(e.target.value)}
                      className={`h-full p-5 bg-cd text-xs sm:text-sm outline-none resize-none font-mono leading-relaxed overflow-y-auto ${
                        viewMode === 'split' ? 'w-1/2 border-r border-[var(--bd)]' : 'w-full'
                      }`}
                      placeholder="Escribe aquí tus roadmaps, notas técnicas, requerimientos o comandos..."
                    />
                  )}

                  {viewMode !== 'edit' && (
                    <div
                      className={`h-full p-5 overflow-y-auto bg-cd ${
                        viewMode === 'split' ? 'w-1/2' : 'w-full'
                      }`}
                    >
                      <MarkdownPreview content={contenido} />
                    </div>
                  )}
                </div>

                <div className="px-4 py-2 border-t border-[var(--bd)] bg-sf flex flex-wrap justify-between items-center gap-2 text-[10px] tx-mu shrink-0">
                  <span>
                    {selectedDoc.isStarter
                      ? 'Guía oficial pre-cargada (al guardar se crea tu copia editable)'
                      : `ID: ${selectedDoc.id}`}
                  </span>
                  <span>
                    Actualizado: {new Date(selectedDoc.updated_at).toLocaleString('es-SV')}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-xs tx-mu gap-2 p-6 text-center">
                <FileText size={40} className="opacity-20" />
                <p className="font-bold text-[var(--tx)]">Selecciona o crea un documento</p>
                <p className="max-w-sm">
                  Aquí puedes consultar las guías actualizadas de Bot Todd, Evolution API, scripts SQL o anotar nuevas ideas del negocio.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ==================== TAB 2: ROADMAP INTERACTIVO OS ==================== */
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-0.5">
          {/* Resumen de progreso + acciones */}
          <div className="bg-cd bd rounded-2xl p-4 space-y-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-black text-sm flex items-center gap-2">
                  <Sparkles size={16} className="text-indigo-500" />
                  Mapa de Evolución TODOENUNO OS
                </h2>
                <p className="text-xs tx-mu">
                  Haz clic en el estado de cualquier hito para avanzarlo (Pendiente → En Progreso → Completado).
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleResetRoadmap}
                  className="px-2.5 py-1.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold flex items-center gap-1 tx-mu hover:text-[var(--tx)]"
                >
                  <RotateCcw size={13} /> Sincronizar Fases
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewMilestone(!showNewMilestone)}
                  className="px-3 py-1.5 rounded-xl bg-[var(--tx)] text-[var(--cd)] text-xs font-bold flex items-center gap-1.5"
                >
                  <Plus size={14} /> Agregar Hito
                </button>
              </div>
            </div>

            {/* Barra de progreso */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold">
                <span>
                  Progreso Global: {roadmapStats.completed} de {roadmapStats.total} hitos completados
                </span>
                <span className="text-emerald-500 font-mono">{roadmapStats.pct}%</span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-sf border border-[var(--bd)] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-300"
                  style={{ width: `${roadmapStats.pct}%` }}
                />
              </div>
            </div>

            {/* Filtros de Roadmap */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {(['Todos', 'Completado', 'En Progreso', 'Pendiente'] as const).map(st => {
                const count =
                  st === 'Todos'
                    ? roadmapStats.total
                    : st === 'Completado'
                    ? roadmapStats.completed
                    : st === 'En Progreso'
                    ? roadmapStats.inProgress
                    : roadmapStats.pending;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setRoadmapFilter(st)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold border transition-colors ${
                      roadmapFilter === st
                        ? 'bg-[var(--tx)] text-[var(--cd)] border-[var(--tx)]'
                        : 'bg-sf border-[var(--bd)] tx-mu hover:text-[var(--tx)]'
                    }`}
                  >
                    {st} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Formulario nuevo hito */}
          {showNewMilestone && (
            <form onSubmit={handleAddMilestone} className="bg-cd bd rounded-2xl p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs uppercase tracking-wider">Nuevo Hito del Roadmap</span>
                <button
                  type="button"
                  onClick={() => setShowNewMilestone(false)}
                  className="text-xs tx-mu hover:text-[var(--tx)]"
                >
                  Cancelar
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  value={msFase}
                  onChange={e => setMsFase(e.target.value)}
                  placeholder="Fase (ej. Sprint 14)"
                  className="px-3 py-2 rounded-xl bg-sf border border-[var(--bd)] text-xs outline-none focus:border-[var(--ac)]"
                />
                <input
                  type="text"
                  value={msTitulo}
                  onChange={e => setMsTitulo(e.target.value)}
                  placeholder="Título del hito (obligatorio)"
                  className="px-3 py-2 rounded-xl bg-sf border border-[var(--bd)] text-xs outline-none focus:border-[var(--ac)] sm:col-span-1"
                  required
                />
                <select
                  value={msEstado}
                  onChange={e => setMsEstado(e.target.value as DocStatus)}
                  className="px-3 py-2 rounded-xl bg-sf border border-[var(--bd)] text-xs outline-none"
                >
                  <option value="Pendiente">Pendiente</option>
                  <option value="En Progreso">En Progreso</option>
                  <option value="Completado">Completado</option>
                </select>
              </div>
              <input
                type="text"
                value={msDesc}
                onChange={e => setMsDesc(e.target.value)}
                placeholder="Descripción breve del objetivo..."
                className="w-full px-3 py-2 rounded-xl bg-sf border border-[var(--bd)] text-xs outline-none focus:border-[var(--ac)]"
              />
              <textarea
                rows={2}
                value={msEntregables}
                onChange={e => setMsEntregables(e.target.value)}
                placeholder="Entregables (uno por línea, opcional)..."
                className="w-full px-3 py-2 rounded-xl bg-sf border border-[var(--bd)] text-xs outline-none resize-none"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                + Guardar Hito en Roadmap
              </button>
            </form>
          )}

          {/* Grid de Tarjetas del Roadmap */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
            {filteredMilestones.map(ms => (
              <div
                key={ms.id}
                className="bg-cd bd rounded-2xl p-4 flex flex-col justify-between gap-3 shadow-sm hover:border-[var(--ac)] transition-colors"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-sf border border-[var(--bd)] text-indigo-500">
                      {ms.fase}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleCycleMilestoneStatus(ms.id)}
                        title="Clic para cambiar estado"
                        className="cursor-pointer hover:opacity-85 transition-opacity"
                      >
                        {getStatusBadge(ms.estado)}
                      </button>
                      {ms.id.startsWith('ms-custom-') && (
                        <button
                          type="button"
                          onClick={() => handleDeleteMilestone(ms.id)}
                          className="p-1 text-rose-400 hover:text-rose-500"
                          title="Eliminar hito"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-black text-sm leading-snug">{ms.titulo}</h3>
                    <p className="text-xs tx-mu mt-1 leading-relaxed">{ms.descripcion}</p>
                  </div>

                  {ms.entregables && ms.entregables.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider tx-mu flex items-center gap-1">
                        <ListChecks size={11} /> Entregables
                      </div>
                      {ms.entregables.map((item, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-[11px] leading-snug">
                          {ms.estado === 'Completado' ? (
                            <CheckCircle2 size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                          ) : (
                            <ArrowRight size={12} className="text-indigo-400 mt-0.5 shrink-0" />
                          )}
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {(ms.sqlFile || ms.moduloRuta) && (
                  <div className="pt-2.5 border-t border-[var(--bd)] flex items-center justify-between gap-2 text-[10px]">
                    {ms.sqlFile ? (
                      <span className="font-mono tx-mu truncate flex items-center gap-1" title={ms.sqlFile}>
                        <Database size={11} className="shrink-0" />
                        <span className="truncate">{ms.sqlFile.replace('docs/', '')}</span>
                      </span>
                    ) : (
                      <span />
                    )}
                    {ms.moduloRuta && (
                      <Link
                        to={ms.moduloRuta}
                        className="font-bold text-[var(--ac)] hover:underline flex items-center gap-1 shrink-0"
                      >
                        {ms.moduloLabel || 'Abrir'} <ExternalLink size={10} />
                      </Link>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
