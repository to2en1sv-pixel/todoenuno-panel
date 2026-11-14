import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
  fetchStockItems,
  fetchProductVariants,
  formatVariantsForTodd,
  compressImageFile,
} from '@/lib/inventory';
import {
  fetchToddCatalogSettings,
  getCachedToddCatalogSettings,
  buildHowToVideoMessage,
  type ToddCatalogSettings,
} from '@/lib/toddSettings';
import {
  evaluateCustomerRisk,
  addOrUpdateBlacklist,
  removeBlacklistEntry,
  cleanPhone,
} from '@/lib/blacklist';
import PedidoModal from '@/components/PedidoModal';
import type { StockItem, ProductVariant } from '@/types/inventory';
import {
  Send,
  Bot,
  User,
  Loader2,
  ChevronLeft,
  Search,
  RefreshCw,
  ShoppingBag,
  AlertCircle,
  CheckCircle2,
  X,
  Phone,
  MessageSquare,
  Paperclip,
  Image as ImageIcon,
  Volume2,
  Video,
  Pencil,
  Check,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Megaphone,
  Zap,
  Settings,
  Plus,
  Trash2,
  EyeOff,
  Eye,
  UserX,
  Package,
} from 'lucide-react';

type Conversation = {
  id: string;
  instance_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  last_message: string | null;
  updated_at?: string;
  status: string | null;
};

type Message = {
  id: string;
  conversation_id: string;
  body: string;
  from_me: boolean;
  created_at: string;
  telefono_real?: string | null;
};

type WhatsappStateRow = {
  telefono: string;
  last_sku?: string | null;
  last_nombre?: string | null;
  last_precio?: number | null;
  last_detalle?: string | null;
  nombre_cliente?: string | null;
  direccion?: string | null;
  metodo_pago?: string | null;
  paso_actual?: string | null;
  updated_at?: string | null;
};

type QuickReply = {
  id: string;
  label: string;
  command: string;
  text: string;
};

const QUICK_REPLIES_KEY = 'unichat_quick_replies_v1';

const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  {
    id: 'qr-transfer',
    label: '🏦 Transferencia',
    command: '/transferencia',
    text: 'Hola {nombre} 😊 Claro, puedes pagar por transferencia bancaria.\n\nBanco Agrícola (Ahorro): [Tu # de cuenta]\nA nombre de: [Tu nombre]\n\nCuando hagas el depósito me envías la captura por aquí para despachar tu pedido 📦',
  },
  {
    id: 'qr-envios',
    label: '🚚 Envíos SV',
    command: '/envios',
    text: 'Hola {nombre} 🚚 Hacemos envíos a todo El Salvador:\n• San Salvador y alrededores: entrega mismo día o siguiente.\n• Departamentos: 24–48 horas hábiles.\n¿En qué municipio o departamento te encuentras?',
  },
  {
    id: 'qr-datos',
    label: '📍 Pedir Datos',
    command: '/datos',
    text: 'Para agendar tu entrega por favor envíame:\n1️⃣ Nombre completo\n2️⃣ Dirección exacta y punto de referencia\n3️⃣ Departamento\n4️⃣ Pago: Contra entrega o Transferencia 📦',
  },
  {
    id: 'qr-confirmado',
    label: '✅ Confirmado',
    command: '/confirmado',
    text: '¡Listo {nombre}! ✅ Tu pedido quedó confirmado para despacho. En cuanto el motorista vaya en ruta te avisaremos por este medio. ¡Gracias por tu compra!',
  },
];

function loadQuickReplies(): QuickReply[] {
  try {
    const raw = localStorage.getItem(QUICK_REPLIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_QUICK_REPLIES;
}

function cleanDigits8(raw?: string | null): string {
  const digits = String(raw || '').split('@')[0].replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : digits;
}

function isLegacyConversation(conv: Conversation): boolean {
  const inst = String(conv.instance_id || '').toLowerCase();
  if (inst === 'builderbot-principal' || inst === 'ventas' || inst === 'builderbot') {
    return true;
  }
  const hasHexId = /^[0-9a-f]{20,}$/i.test(conv.id);
  const placeholderMsg = (conv.last_message || '').trim() === 'Haz clic para ver los mensajes';
  return hasHexId && placeholderMsg;
}

function formatPhoneDisplay(conv: Conversation): string {
  const raw = conv.contact_phone || conv.id || '';
  if (!raw) return 'Sin número';
  if (raw.includes('@lid')) return `WhatsApp LID (${raw.split('@')[0]})`;
  const digits = raw.split('@')[0].replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('503')) {
    return `+503 ${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 8) {
    return `+503 ${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  if (digits.length >= 14 && conv.id.includes('@lid')) {
    return `WhatsApp LID (${digits})`;
  }
  return raw.split('@')[0];
}

function formatMessageTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function parseInlineMediaMarker(body: string): { imgUrl: string | null; text: string } {
  const match = body.match(/^\[IMG:(https?:\/\/[^\]]+)\]\s*([\s\S]*)$/i);
  if (match) {
    return { imgUrl: match[1], text: match[2].trim() };
  }
  return { imgUrl: null, text: body };
}

function detectMediaType(body: string): 'image' | 'audio' | 'video' | null {
  if (body.startsWith('📷 [Imagen]') || body.startsWith('📷 [Imagen enviada]')) return 'image';
  if (body.startsWith('🎤 [Nota de voz]')) return 'audio';
  if (body.startsWith('🎥 [Video]')) return 'video';
  return null;
}

export function UniChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [lastMsgFromMeMap, setLastMsgFromMeMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | 'unread' | 'bot' | 'human'>('all');
  const [hideLegacy, setHideLegacy] = useState(true);

  const [isUpdating, setIsUpdating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [inputText, setInputText] = useState('');
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Panel derecho (contexto cliente & Todd en desktop; vista dedicada en móvil)
  const [showContextPanel, setShowContextPanel] = useState(true);
  const [mobileShowContext, setMobileShowContext] = useState(false);
  const [whatsappState, setWhatsappState] = useState<WhatsappStateRow | null>(null);
  const [blacklistTick, setBlacklistTick] = useState(0);

  // Edición de contacto (@lid / nombre / teléfono)
  const [editingContact, setEditingContact] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  // Catálogo & Variantes para envío rápido en chat
  const [catalogItems, setCatalogItems] = useState<StockItem[]>([]);
  const [catalogVariants, setCatalogVariants] = useState<ProductVariant[]>([]);
  const [showCatalogPicker, setShowCatalogPicker] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [toddSettings, setToddSettings] = useState<ToddCatalogSettings>(() => getCachedToddCatalogSettings());

  // Respuestas rápidas COD
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>(loadQuickReplies);
  const [showQrModal, setShowQrModal] = useState(false);
  const [newQrLabel, setNewQrLabel] = useState('');
  const [newQrCommand, setNewQrCommand] = useState('');
  const [newQrText, setNewQrText] = useState('');

  // Multimedia (adjuntar imagen local, cargar media de Evolution y lightbox)
  const [pendingAttachment, setPendingAttachment] = useState<{
    dataUrl: string;
    fileName: string;
  } | null>(null);
  const [mediaCache, setMediaCache] = useState<Record<string, { dataUrl: string; mimetype: string }>>({});
  const [loadingMediaId, setLoadingMediaId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Modal de Pedido pre-llenado directo desde el chat
  const [showOrderModal, setShowOrderModal] = useState(false);

  // Confirmación de borrado de chat individual
  const [chatToDelete, setChatToDelete] = useState<Conversation | null>(null);
  const [clearToddOnDelete, setClearToddOnDelete] = useState(true);
  const [isDeletingChat, setIsDeletingChat] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showBanner = (type: 'ok' | 'err', text: string) => {
    setBanner({ type, text });
    setTimeout(() => {
      setBanner(prev => (prev?.text === text ? null : prev));
    }, 5000);
  };

  // Cargar catálogo activo y configuración Bot Todd una vez
  useEffect(() => {
    Promise.all([fetchStockItems(), fetchProductVariants(), fetchToddCatalogSettings()])
      .then(([stockRes, vars, cfgRes]) => {
        setCatalogItems((stockRes.items || []).filter(i => i.activo !== false));
        setCatalogVariants((vars || []).filter(v => v.estado !== 'PAUSADO'));
        setToddSettings(cfgRes.settings);
      })
      .catch(() => {});
  }, []);

  const loadConversations = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [{ data: convData }, { data: ordData }, { data: recentMsgs }] = await Promise.all([
        supabase.from('bb_conversations').select('*').order('updated_at', { ascending: false }),
        supabase
          .from('whatsapp_orders')
          .select('id,telefono,nombre_cliente,estado,total,sku,catalogo_sku,codigo_anuncio,motivo_cancelacion,notas,created_at,pedido_codigo')
          .order('created_at', { ascending: false }),
        supabase
          .from('bb_messages')
          .select('conversation_id, from_me, created_at')
          .order('created_at', { ascending: false })
          .limit(300),
      ]);

      if (convData) {
        setConversations(convData as Conversation[]);
        setSelectedConv(prev => {
          if (!prev) return null;
          const updated = (convData as Conversation[]).find(c => c.id === prev.id);
          return updated || prev;
        });
      }

      if (Array.isArray(ordData)) {
        setAllOrders(ordData);
      }

      if (Array.isArray(recentMsgs)) {
        const dirMap: Record<string, boolean> = {};
        for (const m of recentMsgs as any[]) {
          if (m.conversation_id && dirMap[m.conversation_id] === undefined) {
            dirMap[m.conversation_id] = Boolean(m.from_me);
          }
        }
        setLastMsgFromMeMap(dirMap);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Carga inicial y suscripción Realtime
  useEffect(() => {
    loadConversations();

    const channel = supabase
      .channel('crm_updates_evolution_v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bb_conversations' }, () => {
        loadConversations();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bb_messages' }, payload => {
        const newMsg = payload.new as Message;
        if (newMsg.conversation_id) {
          setLastMsgFromMeMap(prev => ({ ...prev, [newMsg.conversation_id]: Boolean(newMsg.from_me) }));
        }
        setSelectedConv(current => {
          if (current && newMsg.conversation_id === current.id) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });

            if (!newMsg.from_me) {
              import('@/lib/osEvents')
                .then(({ emitOsEvent }) => {
                  emitOsEvent({
                    type: 'chat.message.received',
                    source_table: 'bb_messages',
                    source_id: newMsg.id || current.id,
                    payload: {
                      conversation_id: current.id,
                      contact_name: current.contact_name,
                      contact_phone: current.contact_phone,
                      text: newMsg.body,
                      channel: 'whatsapp_evolution',
                    },
                  }).catch(() => {});
                })
                .catch(() => {});
            }
          }
          return current;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadConversations]);

  // Cargar mensajes + estado de Bot Todd del chat activo
  const loadMessagesFor = useCallback(async (conv: Conversation) => {
    const { data } = await supabase
      .from('bb_messages')
      .select('*')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });
    if (data) {
      setMessages(data as Message[]);
      if (data.length > 0) {
        const last = data[data.length - 1] as Message;
        setLastMsgFromMeMap(prev => ({ ...prev, [conv.id]: Boolean(last.from_me) }));
      }
    }
  }, []);

  const loadWhatsappStateFor = useCallback(async (conv: Conversation) => {
    const p8 = cleanDigits8(conv.contact_phone || conv.id);
    const rawId = conv.id.split('@')[0];
    const candidates = Array.from(
      new Set([p8, p8 ? `503${p8}` : '', rawId, conv.contact_phone || ''].filter(Boolean))
    );
    if (candidates.length === 0) {
      setWhatsappState(null);
      return;
    }
    try {
      const { data } = await supabase
        .from('whatsapp_state')
        .select('*')
        .in('telefono', candidates)
        .order('updated_at', { ascending: false })
        .limit(1);
      setWhatsappState(data && data.length > 0 ? (data[0] as WhatsappStateRow) : null);
    } catch {
      setWhatsappState(null);
    }
  }, []);

  useEffect(() => {
    if (!selectedConv) {
      setMessages([]);
      setWhatsappState(null);
      setEditingContact(false);
      return;
    }
    loadMessagesFor(selectedConv);
    loadWhatsappStateFor(selectedConv);
    setEditName(selectedConv.contact_name || '');
    setEditPhone(selectedConv.contact_phone || '');
    setEditingContact(false);
    setMobileShowContext(false);
    setShowCatalogPicker(false);
  }, [selectedConv?.id, loadMessagesFor, loadWhatsappStateFor]);

  // Polling de respaldo cada 5s
  useEffect(() => {
    const timer = setInterval(() => {
      loadConversations(false);
      if (selectedConv) {
        loadMessagesFor(selectedConv);
        loadWhatsappStateFor(selectedConv);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [loadConversations, loadMessagesFor, loadWhatsappStateFor, selectedConv]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedConv?.id]);

  // Índice rápido de pedidos por teléfono
  const orderSummaryMap = useMemo(() => {
    const map: Record<string, { total: number; entregados: number; cancelados: number }> = {};
    allOrders.forEach(o => {
      const p8 = cleanDigits8(o.telefono);
      if (p8.length < 8) return;
      if (!map[p8]) map[p8] = { total: 0, entregados: 0, cancelados: 0 };
      map[p8].total += 1;
      const est = String(o.estado || '').toLowerCase();
      if (est === 'entregado') map[p8].entregados += 1;
      if (est === 'cancelado') map[p8].cancelados += 1;
    });
    return map;
  }, [allOrders]);

  // Lista filtrada y contadores
  const legacyCount = useMemo(
    () => conversations.filter(isLegacyConversation).length,
    [conversations]
  );

  const visibleBaseConversations = useMemo(() => {
    if (!hideLegacy || search.trim()) return conversations;
    return conversations.filter(c => !isLegacyConversation(c));
  }, [conversations, hideLegacy, search]);

  const counts = useMemo(() => {
    let bot = 0;
    let human = 0;
    let unread = 0;
    visibleBaseConversations.forEach(c => {
      if (c.status === 'human') human++;
      else bot++;
      if (lastMsgFromMeMap[c.id] === false) unread++;
    });
    return { total: visibleBaseConversations.length, bot, human, unread };
  }, [visibleBaseConversations, lastMsgFromMeMap]);

  const filteredConversations = useMemo(() => {
    return visibleBaseConversations.filter(c => {
      const isHuman = c.status === 'human';
      if (modeFilter === 'bot' && isHuman) return false;
      if (modeFilter === 'human' && !isHuman) return false;
      if (modeFilter === 'unread' && lastMsgFromMeMap[c.id] !== false) return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return (
        (c.contact_name || '').toLowerCase().includes(q) ||
        (c.contact_phone || '').toLowerCase().includes(q) ||
        (c.last_message || '').toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      );
    });
  }, [visibleBaseConversations, modeFilter, search, lastMsgFromMeMap]);

  // Contexto del contacto activo
  const selectedPhone8 = useMemo(() => {
    if (!selectedConv) return '';
    return cleanPhone(selectedConv.contact_phone || selectedConv.id);
  }, [selectedConv]);

  const selectedRisk = useMemo(() => {
    if (!selectedPhone8 || selectedPhone8.length < 8) return null;
    return evaluateCustomerRisk(selectedPhone8, allOrders);
  }, [selectedPhone8, allOrders, blacklistTick]);

  const selectedOrders = useMemo(() => {
    if (!selectedPhone8 || selectedPhone8.length < 8) return [];
    return allOrders.filter(o => cleanPhone(o.telefono) === selectedPhone8).slice(0, 6);
  }, [allOrders, selectedPhone8]);

  const detectedAdTag = useMemo(() => {
    const det = whatsappState?.last_detalle || '';
    if (det.startsWith('AD:')) return det.slice(3).trim();
    return '';
  }, [whatsappState]);

  // Sugerencias de comando `/` al escribir
  const slashMatches = useMemo(() => {
    if (!inputText.startsWith('/')) return [];
    const q = inputText.toLowerCase().trim();
    return quickReplies.filter(
      qr => qr.command.toLowerCase().includes(q) || qr.label.toLowerCase().includes(q)
    );
  }, [inputText, quickReplies]);

  // Alternar Bot Todd / Humano
  const toggleStatus = async () => {
    if (!selectedConv || isUpdating) return;
    setIsUpdating(true);
    const isCurrentlyBot = selectedConv.status !== 'human';
    const newStatus = isCurrentlyBot ? 'human' : 'bot';

    try {
      let updatedViaApi = false;
      try {
        const res = await fetch('/api/toggle-bot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: selectedConv.id,
            action: newStatus,
            instanceId: selectedConv.instance_id || 'eee',
            contactPhone: selectedConv.contact_phone || selectedConv.id,
          }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (!res.ok) throw new Error(data.details || data.error || 'Error en servidor');
          updatedViaApi = true;
        }
      } catch (apiErr: any) {
        if (apiErr?.message && !apiErr.message.includes('JSON') && !apiErr.message.includes('Failed to fetch')) {
          throw apiErr;
        }
      }

      if (!updatedViaApi) {
        const { error: sbErr } = await supabase
          .from('bb_conversations')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', selectedConv.id);
        if (sbErr) throw sbErr;
      }

      const updatedConv = { ...selectedConv, status: newStatus };
      setSelectedConv(updatedConv);
      setConversations(prev => prev.map(c => (c.id === selectedConv.id ? updatedConv : c)));
      showBanner(
        'ok',
        newStatus === 'human'
          ? 'Modo Humano activado: Bot Todd quedó en silencio para este chat.'
          : 'Bot Todd reactivado: volverá a responder automáticamente en este chat.'
      );
    } catch (error: any) {
      showBanner('err', `No se pudo cambiar el modo: ${error?.message || 'Error desconocido'}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // Guardar edición manual de nombre y teléfono de contacto
  const handleSaveContactInfo = async () => {
    if (!selectedConv) return;
    setSavingContact(true);
    const cleanP = editPhone.trim();
    const cleanN = editName.trim() || formatPhoneDisplay(selectedConv);
    const { error } = await supabase
      .from('bb_conversations')
      .update({
        contact_name: cleanN,
        contact_phone: cleanP || selectedConv.contact_phone,
      })
      .eq('id', selectedConv.id);
    setSavingContact(false);

    if (error) {
      showBanner('err', `No se pudo actualizar el contacto: ${error.message}`);
      return;
    }

    const updated = { ...selectedConv, contact_name: cleanN, contact_phone: cleanP || selectedConv.contact_phone };
    setSelectedConv(updated);
    setConversations(prev => prev.map(c => (c.id === selectedConv.id ? updated : c)));
    setEditingContact(false);
    showBanner('ok', 'Datos del contacto actualizados en Supabase.');
  };

  // Reiniciar estado de Bot Todd en whatsapp_state
  const handleResetToddState = async () => {
    if (!selectedConv) return;
    const p8 = cleanDigits8(selectedConv.contact_phone || selectedConv.id);
    const targets = Array.from(
      new Set([p8, p8 ? `503${p8}` : '', whatsappState?.telefono || ''].filter(Boolean))
    );
    if (targets.length === 0) return;

    const { error } = await supabase
      .from('whatsapp_state')
      .update({
        paso_actual: 'inicio',
        last_sku: null,
        last_nombre: null,
        last_precio: null,
        updated_at: new Date().toISOString(),
      })
      .in('telefono', targets);

    if (error) {
      showBanner('err', `Error reiniciando estado de Todd: ${error.message}`);
    } else {
      setWhatsappState(prev => (prev ? { ...prev, paso_actual: 'inicio', last_sku: null, last_nombre: null } : null));
      showBanner('ok', 'Estado de Bot Todd reiniciado a "inicio" para este cliente.');
    }
  };

  // Eliminar conversación individual (hilo + mensajes + opcional estado Todd)
  const handleConfirmDeleteChat = async () => {
    if (!chatToDelete || isDeletingChat) return;
    const target = chatToDelete;
    setIsDeletingChat(true);

    try {
      let deletedViaApi = false;
      try {
        const res = await fetch('/api/delete-conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: target.id,
            contactPhone: target.contact_phone || target.id,
            clearToddState: clearToddOnDelete,
          }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (!res.ok) throw new Error(data.details || data.error || 'Error eliminando conversación');
          deletedViaApi = true;
        }
      } catch (apiErr: any) {
        if (
          apiErr?.message &&
          !apiErr.message.includes('JSON') &&
          !apiErr.message.includes('Failed to fetch')
        ) {
          throw apiErr;
        }
      }

      if (!deletedViaApi) {
        const { error: msgErr } = await supabase
          .from('bb_messages')
          .delete()
          .eq('conversation_id', target.id);
        if (msgErr) throw msgErr;

        const { error: convErr } = await supabase
          .from('bb_conversations')
          .delete()
          .eq('id', target.id);
        if (convErr) throw convErr;

        if (clearToddOnDelete) {
          const p8 = cleanDigits8(target.contact_phone || target.id);
          const rawId = target.id.split('@')[0];
          const targets = Array.from(
            new Set([target.id, rawId, p8, p8 ? `503${p8}` : ''].filter(Boolean))
          );
          if (targets.length > 0) {
            await supabase.from('whatsapp_state').delete().in('telefono', targets);
          }
        }
      }

      setConversations(prev => prev.filter(c => c.id !== target.id));
      setLastMsgFromMeMap(prev => {
        if (!(target.id in prev)) return prev;
        const copy = { ...prev };
        delete copy[target.id];
        return copy;
      });
      if (selectedConv?.id === target.id) {
        setSelectedConv(null);
        setMessages([]);
        setWhatsappState(null);
        setMobileShowContext(false);
        setEditingContact(false);
      }

      const label = target.contact_name || formatPhoneDisplay(target);
      setChatToDelete(null);
      showBanner('ok', `Chat de "${label}" eliminado correctamente.`);
    } catch (error: any) {
      showBanner('err', `No se pudo eliminar el chat: ${error?.message || 'Error desconocido'}`);
    } finally {
      setIsDeletingChat(false);
    }
  };

  // Cargar foto/audio/video desde Evolution v2.3.7
  const handleLoadMedia = async (msg: Message) => {
    if (!selectedConv || loadingMediaId === msg.id) return;
    setLoadingMediaId(msg.id);
    try {
      const res = await fetch('/api/evolution-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: msg.id,
          remoteJid: selectedConv.id,
          fromMe: msg.from_me,
          instanceId: selectedConv.instance_id || 'eee',
        }),
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        throw new Error('La descarga multimedia requiere estar desplegado en Vercel.');
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || 'Error cargando multimedia');

      const mimetype = data.mimetype || 'application/octet-stream';
      const dataUrl = data.base64.startsWith('data:')
        ? data.base64
        : `data:${mimetype};base64,${data.base64}`;
      setMediaCache(prev => ({ ...prev, [msg.id]: { dataUrl, mimetype } }));
    } catch (err: any) {
      showBanner('err', err?.message || 'No se pudo cargar el archivo multimedia');
    } finally {
      setLoadingMediaId(null);
    }
  };

  // Enviar texto o media por Evolution v2.3.7
  const sendPayloadToEvolution = async (opts: {
    text: string;
    mediaUrl?: string | null;
    mediaBase64?: string | null;
    fileName?: string;
    productSku?: string;
    sendVideoAfterImage?: boolean;
  }) => {
    if (!selectedConv) return;
    setIsSending(true);
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selectedConv.id,
          text: opts.text,
          instanceId: selectedConv.instance_id || 'eee',
          contactPhone: selectedConv.contact_phone || selectedConv.id,
          pauseBot: true,
          mediaUrl: opts.mediaUrl || undefined,
          mediaBase64: opts.mediaBase64 || undefined,
          mediaType: opts.mediaUrl || opts.mediaBase64 ? 'image' : undefined,
          fileName: opts.fileName || undefined,
          productSku: opts.productSku || undefined,
          sendVideoAfterImage: opts.sendVideoAfterImage,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(
          'El endpoint /api/send-message requiere despliegue en Vercel con EVOLUTION_API_URL y EVOLUTION_API_KEY.'
        );
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || 'Error enviando por Evolution');

      const optimisticId = String(data.messageId || `local-${Date.now()}`);
      const nowIso = new Date().toISOString();
      const bodyToAdd = data.storedBody || opts.text || '📷 [Imagen enviada]';
      const followUp = data.followUpVideoMessage as
        | { id: string; body: string; created_at: string }
        | null
        | undefined;

      setMessages(prev => {
        const next = [...prev];
        if (!next.some(m => m.id === optimisticId)) {
          next.push({
            id: optimisticId,
            conversation_id: selectedConv.id,
            body: bodyToAdd,
            from_me: true,
            created_at: nowIso,
            telefono_real: selectedConv.contact_phone,
          });
        }
        if (followUp?.id && !next.some(m => m.id === followUp.id)) {
          next.push({
            id: followUp.id,
            conversation_id: selectedConv.id,
            body: followUp.body,
            from_me: true,
            created_at: followUp.created_at || nowIso,
            telefono_real: selectedConv.contact_phone,
          });
        }
        return next;
      });
      const inlineDataImage =
        opts.mediaBase64 ||
        (opts.mediaUrl && opts.mediaUrl.startsWith('data:') ? opts.mediaUrl : null);
      if (inlineDataImage) {
        const mimeMatch = inlineDataImage.match(/^data:([^;]+);/i);
        setMediaCache(prev => ({
          ...prev,
          [optimisticId]: {
            dataUrl: inlineDataImage,
            mimetype: mimeMatch?.[1] || 'image/jpeg',
          },
        }));
      }

      setLastMsgFromMeMap(prev => ({ ...prev, [selectedConv.id]: true }));
      const updatedConv: Conversation = {
        ...selectedConv,
        last_message: followUp ? '🎥 Video How-To enviado' : opts.text || '📷 Imagen enviada',
        updated_at: followUp?.created_at || nowIso,
        status: 'human',
      };
      setSelectedConv(updatedConv);
      setConversations(prev => prev.map(c => (c.id === selectedConv.id ? updatedConv : c)));
      return true;
    } catch (error: any) {
      showBanner('err', `No se pudo enviar: ${error?.message || 'Error de conexión'}`);
      return false;
    } finally {
      setIsSending(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && !pendingAttachment) || !selectedConv || isSending) return;

    const textToSend = inputText.trim();
    const attach = pendingAttachment;
    setInputText('');
    setPendingAttachment(null);

    const ok = await sendPayloadToEvolution({
      text: textToSend,
      mediaBase64: attach?.dataUrl || null,
      fileName: attach?.fileName,
    });

    if (!ok) {
      setInputText(textToSend);
      if (attach) setPendingAttachment(attach);
    }
  };

  const handleInsertQuickReply = (qr: QuickReply) => {
    const rawName = (selectedConv?.contact_name || '').trim();
    const firstName =
      rawName && !/^\d+$/.test(rawName) && !rawName.includes('@')
        ? rawName.split(' ')[0]
        : 'amigo/a';
    const rendered = qr.text.replace(/\{nombre\}/gi, firstName);
    setInputText(rendered);
  };

  const handleSendCatalogProduct = async (prod: StockItem, withImage: boolean) => {
    if (!selectedConv) return;
    const skuUpper = prod.sku.trim().toUpperCase();
    const allowBackorder =
      toddSettings.allowBackorderGlobal || toddSettings.backorderSkus.includes(skuUpper);
    const hideCounts = toddSettings.hideExactStockCounts;

    const prodVars = prod.template_id
      ? catalogVariants.filter(v => String(v.template_id) === String(prod.template_id))
      : [];
    const formatted = formatVariantsForTodd(prodVars, prod.precio_venta, {
      allowBackorder,
      hideExactCounts: hideCounts,
    });

    const lines: string[] = [
      `*${prod.nombre}* — *$${Number(prod.precio_venta || 0).toFixed(2)}*`,
    ];
    if (prod.todd_pitch) lines.push(prod.todd_pitch.trim());
    if (formatted.bulletLines.length > 0) {
      lines.push(`\n🎨 *Disponibilidad:*\n${formatted.bulletLines.map(b => `• ${b}`).join('\n')}`);
    } else if (!hideCounts) {
      lines.push(`📦 Disponibles: ${prod.stock_disponible} uds`);
    } else {
      const avail = prod.stock_disponible > 0 || allowBackorder;
      lines.push(avail ? '📦 Disponible para envío' : '⏳ Agotado temporalmente');
    }
    lines.push('\n¿Te gustaría reservarlo o tienes alguna duda? 😊');

    let resolvedMediaUrl: string | null = null;
    if (withImage && prod.image_url) {
      const rawUrl = prod.image_url.trim();
      resolvedMediaUrl = rawUrl.startsWith('/') ? `${window.location.origin}${rawUrl}` : rawUrl;
    }

    setShowCatalogPicker(false);
    await sendPayloadToEvolution({
      text: lines.join('\n'),
      mediaUrl: resolvedMediaUrl,
      fileName: `${prod.sku}.jpg`,
      productSku: withImage ? prod.sku : undefined,
      sendVideoAfterImage: withImage,
    });
  };

  const handleSendCatalogVideo = async (prodName: string, videoUrl: string) => {
    if (!selectedConv || !videoUrl.trim()) return;
    setShowCatalogPicker(false);
    await sendPayloadToEvolution({
      text: buildHowToVideoMessage(prodName, videoUrl),
    });
  };

  const handlePickLocalImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 960, 960, 0.82);
      setPendingAttachment({ dataUrl: compressed, fileName: file.name });
    } catch {
      showBanner('err', 'No se pudo procesar la imagen seleccionada.');
    }
  };

  const handleAddQuickReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQrLabel.trim() || !newQrText.trim()) return;
    const cmdRaw = newQrCommand.trim() || `/${newQrLabel.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)}`;
    const next: QuickReply[] = [
      ...quickReplies,
      {
        id: `qr-${Date.now()}`,
        label: newQrLabel.trim(),
        command: cmdRaw.startsWith('/') ? cmdRaw : `/${cmdRaw}`,
        text: newQrText.trim(),
      },
    ];
    setQuickReplies(next);
    localStorage.setItem(QUICK_REPLIES_KEY, JSON.stringify(next));
    setNewQrLabel('');
    setNewQrCommand('');
    setNewQrText('');
  };

  const handleDeleteQuickReply = (id: string) => {
    const next = quickReplies.filter(q => q.id !== id);
    setQuickReplies(next);
    localStorage.setItem(QUICK_REPLIES_KEY, JSON.stringify(next));
  };

  const filteredCatalog = useMemo(() => {
    if (!catalogSearch.trim()) return catalogItems;
    const q = catalogSearch.toLowerCase().trim();
    return catalogItems.filter(
      p => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [catalogItems, catalogSearch]);

  const orderInitialValues = useMemo(() => {
    if (!selectedConv) return null;
    const nameGuess =
      whatsappState?.nombre_cliente ||
      (selectedConv.contact_name && !selectedConv.contact_name.includes('@')
        ? selectedConv.contact_name
        : '');
    return {
      nombre_cliente: nameGuess,
      telefono: selectedPhone8.length >= 8 ? selectedPhone8 : '',
      direccion: whatsappState?.direccion || '',
      codigo_anuncio: detectedAdTag || '',
      catalogo_sku: whatsappState?.last_sku || '',
      metodo_pago: whatsappState?.metodo_pago || 'Contra entrega',
      notas: selectedConv.id.includes('@lid') ? `Chat LID: ${selectedConv.id}` : '',
    };
  }, [selectedConv, whatsappState, selectedPhone8, detectedAdTag]);

  return (
    <div className="flex flex-col gap-2 lg:gap-3 -mx-4 -mt-6 -mb-20 lg:mx-0 lg:mt-0 lg:mb-0 h-[calc(100dvh-116px-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-48px)] min-h-[420px] lg:min-h-[520px] w-auto lg:w-full min-w-0">
      {/* Notificación inline */}
      {banner && (
        <div
          className={`mx-3 mt-2 lg:mx-0 lg:mt-0 px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 shrink-0 ${
            banner.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-500'
          }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            {banner.type === 'ok' ? <CheckCircle2 size={15} className="shrink-0" /> : <AlertCircle size={15} className="shrink-0" />}
            <span className="truncate">{banner.text}</span>
          </span>
          <button onClick={() => setBanner(null)} className="opacity-70 hover:opacity-100 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row flex-1 min-h-0 min-w-0 w-full bg-cd border-0 lg:border lg:border-[var(--bd)] rounded-none lg:rounded-2xl overflow-hidden shadow-sm">
        {/* 1. COLUMNA IZQUIERDA: BANDEJA INTELIGENTE */}
        <div
          className={`w-full lg:w-[265px] xl:w-[300px] shrink-0 lg:border-r border-[var(--bd)] flex-col min-h-0 ${
            selectedConv ? 'hidden lg:flex' : 'flex flex-1 lg:flex-none'
          }`}
        >
          <div className="p-3 sm:p-3.5 border-b border-[var(--bd)] bg-sf space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquare size={17} className="text-emerald-500" />
                <h2 className="font-black text-sm tracking-tight">UniChat</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Evolution 2.3
                </span>
              </div>
              <div className="flex items-center gap-1">
                {legacyCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setHideLegacy(!hideLegacy)}
                    title={hideLegacy ? `Mostrar ${legacyCount} chats antiguos de BuilderBot` : 'Ocultar chats antiguos de BuilderBot'}
                    className={`p-1.5 rounded-lg border text-[10px] font-bold flex items-center gap-1 transition-colors ${
                      hideLegacy
                        ? 'border-[var(--bd)] bg-cd tx-mu hover:text-[var(--tx)]'
                        : 'border-indigo-500/40 bg-indigo-500/10 text-indigo-500'
                    }`}
                  >
                    {hideLegacy ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                )}
                <button
                  onClick={() => loadConversations(true)}
                  title="Recargar conversaciones"
                  className="p-1.5 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf transition-colors"
                >
                  <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Buscador */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 tx-mu" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar cliente, teléfono o texto..."
                className="w-full pl-8 pr-7 py-2 sm:py-1.5 rounded-xl bg-cd border border-[var(--bd)] text-sm sm:text-xs outline-none focus:border-[var(--ac)]"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 tx-mu hover:text-[var(--tx)]"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Filtros */}
            <div className="flex items-center gap-1 p-0.5 bg-cd rounded-xl border border-[var(--bd)] text-[10px] font-bold overflow-x-auto">
              <button
                type="button"
                onClick={() => setModeFilter('all')}
                className={`flex-1 py-1.5 sm:py-1 px-2 rounded-lg whitespace-nowrap transition-colors ${
                  modeFilter === 'all' ? 'bg-[var(--tx)] text-[var(--cd)]' : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                Todos ({counts.total})
              </button>
              <button
                type="button"
                onClick={() => setModeFilter('unread')}
                className={`flex-1 py-1.5 sm:py-1 px-2 rounded-lg whitespace-nowrap transition-colors ${
                  modeFilter === 'unread' ? 'bg-emerald-600 text-white' : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                Sin resp.{counts.unread > 0 ? ` (${counts.unread})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setModeFilter('bot')}
                className={`flex-1 py-1.5 sm:py-1 px-2 rounded-lg whitespace-nowrap transition-colors ${
                  modeFilter === 'bot' ? 'bg-purple-600 text-white' : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                Todd ({counts.bot})
              </button>
              <button
                type="button"
                onClick={() => setModeFilter('human')}
                className={`flex-1 py-1.5 sm:py-1 px-2 rounded-lg whitespace-nowrap transition-colors ${
                  modeFilter === 'human' ? 'bg-amber-500 text-zinc-950' : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                Hum. ({counts.human})
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && conversations.length === 0 ? (
              <div className="p-6 text-center text-xs tx-mu flex flex-col items-center gap-2">
                <Loader2 size={18} className="animate-spin" />
                Cargando chats desde Supabase...
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-5 text-center text-xs tx-mu space-y-2">
                <p>No hay conversaciones en este filtro.</p>
                {hideLegacy && legacyCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setHideLegacy(false)}
                    className="text-[11px] font-bold text-[var(--ac)] hover:underline"
                  >
                    Mostrar {legacyCount} chats legacy de BuilderBot
                  </button>
                )}
              </div>
            ) : (
              filteredConversations.map(conv => {
                const isHuman = conv.status === 'human';
                const needsReply = lastMsgFromMeMap[conv.id] === false;
                const p8 = cleanDigits8(conv.contact_phone || conv.id);
                const ordInfo = p8.length >= 8 ? orderSummaryMap[p8] : undefined;

                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConv(conv)}
                    className={`group p-3 border-b border-[var(--bd)] cursor-pointer hover:bg-sf/70 transition-colors ${
                      selectedConv?.id === conv.id ? 'bg-sf border-l-4 border-l-[var(--ac)]' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <div className="min-w-0 flex items-start gap-1.5">
                        {needsReply && (
                          <span
                            className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0 animate-pulse"
                            title="Cliente esperando respuesta"
                          />
                        )}
                        <div className="min-w-0">
                          <span className="font-bold text-xs block truncate text-[var(--tx)]">
                            {conv.contact_name || formatPhoneDisplay(conv)}
                          </span>
                          <span className="text-[10px] font-mono tx-mu block truncate">
                            {formatPhoneDisplay(conv)}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${
                            isHuman
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                              : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30'
                          }`}
                        >
                          {isHuman ? <User size={9} /> : <Bot size={9} />}
                          {isHuman ? 'Humano' : 'Todd'}
                        </span>
                        {ordInfo && (
                          <span
                            className={`text-[9px] font-bold ${
                              ordInfo.cancelados >= 2 ? 'text-rose-500' : 'text-emerald-600'
                            }`}
                          >
                            {ordInfo.cancelados >= 2
                              ? `⚠️ ${ordInfo.cancelados} canc.`
                              : ordInfo.entregados > 0
                              ? `✓ ${ordInfo.entregados} ped.`
                              : `${ordInfo.total} ped.`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className={`text-[11px] truncate min-w-0 ${needsReply ? 'font-semibold text-[var(--tx)]' : 'tx-mu'}`}>
                        {conv.last_message || 'Sin mensajes'}
                      </div>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          setClearToddOnDelete(true);
                          setChatToDelete(conv);
                        }}
                        title="Eliminar este chat"
                        aria-label="Eliminar este chat"
                        className="p-1 rounded-md text-rose-500/70 hover:text-rose-500 hover:bg-rose-500/10 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 2. COLUMNA CENTRAL: VENTANA DE CHAT */}
        <div
          className={`flex-1 flex-col bg-sf min-h-0 min-w-0 overflow-hidden ${
            selectedConv && !mobileShowContext ? 'flex' : !selectedConv ? 'hidden lg:flex' : 'hidden lg:flex'
          }`}
        >
          {selectedConv ? (
            <>
              {/* Header del Chat (compacto en móvil, completo en desktop) */}
              <div className="px-2.5 py-2 sm:p-3 border-b border-[var(--bd)] bg-cd flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedConv(null);
                      setMobileShowContext(false);
                    }}
                    className="lg:hidden p-1.5 bg-sf border border-[var(--bd)] rounded-lg tx-mu hover:text-[var(--tx)] shrink-0"
                    title="Volver a conversaciones"
                  >
                    <ChevronLeft size={18} />
                  </button>

                  {editingContact ? (
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        placeholder="Nombre cliente"
                        className="px-2 py-1 rounded-lg bg-sf border border-[var(--bd)] text-xs w-28 sm:w-36 outline-none focus:border-[var(--ac)]"
                      />
                      <input
                        type="text"
                        value={editPhone}
                        onChange={e => setEditPhone(e.target.value)}
                        placeholder="Ej. 50371234567"
                        className="px-2 py-1 rounded-lg bg-sf border border-[var(--bd)] text-xs font-mono w-28 sm:w-32 outline-none focus:border-[var(--ac)]"
                      />
                      <button
                        type="button"
                        onClick={handleSaveContactInfo}
                        disabled={savingContact}
                        className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500"
                        title="Guardar datos"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingContact(false)}
                        className="p-1.5 rounded-lg border border-[var(--bd)] tx-mu"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-xs sm:text-sm truncate">
                          {selectedConv.contact_name || formatPhoneDisplay(selectedConv)}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setEditingContact(true)}
                          className="p-1 rounded hover:bg-sf tx-mu hover:text-[var(--tx)] shrink-0"
                          title="Editar nombre o vincular teléfono real"
                        >
                          <Pencil size={11} />
                        </button>
                        <span className="hidden sm:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-sf border border-[var(--bd)] tx-mu shrink-0">
                          {selectedConv.instance_id || 'eee'}
                        </span>
                        {detectedAdTag && (
                          <span className="hidden md:inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 items-center gap-1 truncate max-w-[140px]">
                            <Megaphone size={10} className="shrink-0" /> {detectedAdTag}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] sm:text-[11px] font-mono tx-mu flex items-center gap-1 truncate">
                        <Phone size={10} className="shrink-0" />
                        <span className="truncate">{formatPhoneDisplay(selectedConv)}</span>
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowOrderModal(true)}
                    className="px-2 sm:px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1 transition-colors shadow-sm"
                    title="Crear Pedido"
                  >
                    <ShoppingBag size={13} />
                    <span className="hidden sm:inline">Crear Pedido</span>
                    <span className="sm:hidden">Pedido</span>
                  </button>

                  <button
                    onClick={toggleStatus}
                    disabled={isUpdating}
                    title={selectedConv.status === 'human' ? 'Activar Bot Todd' : 'Pausar Bot Todd'}
                    className={`px-2 sm:px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold flex items-center gap-1 transition-all ${
                      selectedConv.status === 'human'
                        ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-sm'
                        : 'bg-purple-600 text-white hover:bg-purple-500 shadow-sm'
                    } ${isUpdating ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    {isUpdating ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : selectedConv.status === 'human' ? (
                      <>
                        <User size={13} />
                        <span className="hidden sm:inline">Humano (Activar Todd)</span>
                        <span className="sm:hidden">Hum.</span>
                      </>
                    ) : (
                      <>
                        <Bot size={13} />
                        <span className="hidden sm:inline">Todd Activo (Pausar)</span>
                        <span className="sm:hidden">Todd</span>
                      </>
                    )}
                  </button>

                  {/* Botón Ficha Cliente en Móvil */}
                  <button
                    type="button"
                    onClick={() => setMobileShowContext(true)}
                    title="Ver ficha antifraude, estado Todd y pedidos"
                    className="lg:hidden px-2 py-1.5 rounded-lg border border-[var(--bd)] bg-sf hover:bg-cd text-[11px] font-bold flex items-center gap-1"
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        selectedRisk?.nivelRiesgo === 'rojo'
                          ? 'bg-rose-500'
                          : selectedRisk?.nivelRiesgo === 'verde'
                          ? 'bg-emerald-500'
                          : 'bg-amber-500'
                      }`}
                    />
                    <span>Ficha</span>
                  </button>

                  {/* Botón Ficha Cliente en Desktop */}
                  <button
                    type="button"
                    onClick={() => setShowContextPanel(!showContextPanel)}
                    title={showContextPanel ? 'Ocultar ficha cliente' : 'Ver ficha cliente'}
                    className="hidden lg:flex p-1.5 rounded-lg border border-[var(--bd)] bg-sf hover:bg-cd tx-mu hover:text-[var(--tx)] transition-colors"
                  >
                    {showContextPanel ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                  </button>

                  {/* Botón Eliminar Chat */}
                  <button
                    type="button"
                    onClick={() => {
                      setClearToddOnDelete(true);
                      setChatToDelete(selectedConv);
                    }}
                    title="Eliminar esta conversación"
                    aria-label="Eliminar esta conversación"
                    className="p-1.5 rounded-lg border border-[var(--bd)] bg-sf hover:bg-rose-500/10 hover:border-rose-500/30 tx-mu hover:text-rose-500 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {selectedConv.status !== 'human' && (
                <div className="px-3 sm:px-4 py-1.5 bg-purple-500/10 border-b border-purple-500/20 text-[10px] sm:text-[11px] text-purple-600 dark:text-purple-300 flex items-center justify-between gap-2 shrink-0">
                  <span className="truncate">
                    🤖 <strong>Bot Todd</strong> activo. Al responder abajo, Todd se pausará automáticamente.
                  </span>
                </div>
              )}

              {/* Mensajes */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-4 flex flex-col gap-2.5 bg-cd relative min-h-0">
                {messages.length === 0 ? (
                  <div className="m-auto text-xs tx-mu">No hay mensajes registrados en esta conversación.</div>
                ) : (
                  messages.map(msg => {
                    const { imgUrl, text } = parseInlineMediaMarker(msg.body || '');
                    const mediaKind = !imgUrl ? detectMediaType(msg.body || '') : null;
                    const cachedMedia = mediaCache[msg.id];

                    return (
                      <div
                        key={msg.id}
                        className={`max-w-[88%] sm:max-w-[74%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                          msg.from_me
                            ? 'self-end bg-[var(--tx)] text-[var(--cd)] rounded-br-sm'
                            : 'self-start bg-sf border border-[var(--bd)] text-[var(--tx)] rounded-bl-sm'
                        }`}
                      >
                        {imgUrl && (
                          <img
                            src={imgUrl}
                            alt="Producto enviado"
                            onClick={() => setLightboxUrl(imgUrl)}
                            className="w-48 max-w-full max-h-56 object-cover rounded-xl mb-1.5 cursor-pointer border border-black/15 hover:opacity-90"
                          />
                        )}

                        {cachedMedia && cachedMedia.mimetype.startsWith('image/') && (
                          <img
                            src={cachedMedia.dataUrl}
                            alt="Adjunto"
                            onClick={() => setLightboxUrl(cachedMedia.dataUrl)}
                            className="w-56 max-h-64 object-cover rounded-xl mb-1.5 cursor-pointer border border-black/15"
                          />
                        )}

                        {cachedMedia && cachedMedia.mimetype.startsWith('audio/') && (
                          <audio
                            controls
                            src={cachedMedia.dataUrl}
                            className="max-w-[240px] h-9 mb-1"
                          />
                        )}

                        {cachedMedia && cachedMedia.mimetype.startsWith('video/') && (
                          <video
                            controls
                            src={cachedMedia.dataUrl}
                            className="w-56 max-h-56 rounded-xl mb-1.5"
                          />
                        )}

                        {text && <div className="whitespace-pre-wrap break-words">{text}</div>}

                        {mediaKind && !cachedMedia && (
                          <button
                            type="button"
                            onClick={() => handleLoadMedia(msg)}
                            disabled={loadingMediaId === msg.id}
                            className={`mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                              msg.from_me
                                ? 'border-white/25 bg-white/10 hover:bg-white/20'
                                : 'border-[var(--bd)] bg-cd hover:border-[var(--ac)]'
                            }`}
                          >
                            {loadingMediaId === msg.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : mediaKind === 'image' ? (
                              <ImageIcon size={11} />
                            ) : mediaKind === 'audio' ? (
                              <Volume2 size={11} />
                            ) : (
                              <Video size={11} />
                            )}
                            {loadingMediaId === msg.id
                              ? 'Descargando...'
                              : mediaKind === 'image'
                              ? 'Ver imagen real'
                              : mediaKind === 'audio'
                              ? 'Escuchar nota de voz'
                              : 'Cargar video'}
                          </button>
                        )}

                        {msg.created_at && (
                          <div className="text-[9px] opacity-60 mt-1 text-right font-mono">
                            {formatMessageTime(msg.created_at)}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {/* Selector Flotante de Catálogo para enviar producto + foto */}
              {showCatalogPicker && (
                <div className="border-t border-[var(--bd)] bg-sf p-2.5 sm:p-3 space-y-2 max-h-[42dvh] sm:max-h-64 flex flex-col shrink-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold flex items-center gap-1.5">
                        <Package size={13} className="text-indigo-500" /> Catálogo Visual + Variantes
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowCatalogPicker(false)}
                        className="sm:hidden p-1 rounded-lg tx-mu hover:text-[var(--tx)]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={catalogSearch}
                        onChange={e => setCatalogSearch(e.target.value)}
                        placeholder="Buscar producto..."
                        className="px-2.5 py-1.5 sm:py-1 rounded-lg bg-cd border border-[var(--bd)] text-xs sm:text-[11px] flex-1 sm:w-40 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCatalogPicker(false)}
                        className="hidden sm:inline-flex p-1 rounded-lg tx-mu hover:text-[var(--tx)]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {filteredCatalog.slice(0, 12).map(prod => {
                      const pVars = prod.template_id
                        ? catalogVariants.filter(v => String(v.template_id) === String(prod.template_id))
                        : [];
                      const videoUrl = toddSettings.productVideos[prod.sku.toUpperCase()] || '';
                      return (
                        <div
                          key={prod.sku}
                          className="p-2 rounded-xl bg-cd border border-[var(--bd)] flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-10 h-10 rounded-lg bg-sf border border-[var(--bd)] overflow-hidden shrink-0 flex items-center justify-center">
                              {prod.image_url ? (
                                <img src={prod.image_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <Package size={14} className="opacity-40" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold truncate">{prod.nombre}</div>
                              <div className="text-[10px] tx-mu font-mono">
                                ${Number(prod.precio_venta || 0).toFixed(2)} · {prod.stock_disponible} uds
                                {pVars.length > 0 ? ` · ${pVars.length} var.` : ''}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {videoUrl && (
                              <button
                                type="button"
                                disabled={isSending}
                                onClick={() => handleSendCatalogVideo(prod.nombre, videoUrl)}
                                className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-600 text-rose-600 dark:text-rose-400 hover:text-white border border-rose-500/30 text-[10px] font-bold flex items-center gap-1 transition-colors"
                                title="Enviar video How-To de YouTube"
                              >
                                <Video size={11} /> Video
                              </button>
                            )}
                            {prod.image_url && (
                              <button
                                type="button"
                                disabled={isSending}
                                onClick={() => handleSendCatalogProduct(prod, true)}
                                className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold"
                                title={
                                  videoUrl
                                    ? 'Enviar foto + ficha (y video How-To automático)'
                                    : 'Enviar foto + ficha por WhatsApp'
                                }
                              >
                                Foto+Info
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isSending}
                              onClick={() => handleSendCatalogProduct(prod, false)}
                              className="px-2 py-1 rounded-lg border border-[var(--bd)] bg-sf hover:bg-cd text-[10px] font-bold"
                              title="Enviar solo texto con colores y precios"
                            >
                              Texto
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Menú comando / */}
              {slashMatches.length > 0 && (
                <div className="border-t border-[var(--bd)] bg-sf px-3 py-2 flex flex-wrap gap-1.5">
                  {slashMatches.map(qr => (
                    <button
                      key={qr.id}
                      type="button"
                      onClick={() => handleInsertQuickReply(qr)}
                      className="px-2.5 py-1 rounded-lg bg-cd border border-indigo-500/30 hover:border-indigo-500 text-[11px] font-bold flex items-center gap-1.5"
                    >
                      <span className="font-mono text-indigo-500">{qr.command}</span>
                      <span>{qr.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Barra de Respuestas Rápidas COD */}
              <div className="px-3 py-1.5 bg-cd border-t border-[var(--bd)] flex items-center gap-1.5 overflow-x-auto">
                <Zap size={12} className="text-amber-500 shrink-0" />
                {quickReplies.map(qr => (
                  <button
                    key={qr.id}
                    type="button"
                    onClick={() => handleInsertQuickReply(qr)}
                    className="px-2 py-1 rounded-lg bg-sf border border-[var(--bd)] hover:border-[var(--ac)] text-[10px] font-bold whitespace-nowrap transition-colors"
                    title={qr.text}
                  >
                    {qr.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowQrModal(true)}
                  className="ml-auto px-2 py-1 rounded-lg border border-[var(--bd)] tx-mu hover:text-[var(--tx)] text-[10px] font-bold flex items-center gap-1 shrink-0"
                  title="Configurar respuestas rápidas"
                >
                  <Settings size={11} />
                </button>
              </div>

              {/* Previsualización de Imagen Adjunta */}
              {pendingAttachment && (
                <div className="px-3 py-2 bg-sf border-t border-[var(--bd)] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <img
                      src={pendingAttachment.dataUrl}
                      alt="Adjunto"
                      className="w-10 h-10 rounded-lg object-cover border border-[var(--bd)]"
                    />
                    <div className="text-xs">
                      <span className="font-bold block">Imagen lista para enviar</span>
                      <span className="text-[10px] tx-mu">Escribe un comentario opcional abajo o dale Enviar</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                    className="p-1 rounded-lg tx-mu hover:text-rose-500"
                  >
                    <X size={15} />
                  </button>
                </div>
              )}

              {/* Input Principal */}
              <form
                onSubmit={handleSendMessage}
                className="p-2 sm:p-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-cd border-t border-[var(--bd)] flex items-center gap-1.5 sm:gap-2 shrink-0"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePickLocalImage}
                />
                <button
                  type="button"
                  onClick={() => setShowCatalogPicker(!showCatalogPicker)}
                  title="Enviar producto del Catálogo Visual"
                  className={`p-2 rounded-xl border transition-colors shrink-0 ${
                    showCatalogPicker
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-sf border-[var(--bd)] tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  <Paperclip size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Adjuntar foto desde tu PC/celular"
                  className="p-2 rounded-xl border border-[var(--bd)] bg-sf tx-mu hover:text-[var(--tx)] transition-colors shrink-0"
                >
                  <ImageIcon size={16} />
                </button>
                <input
                  type="text"
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  placeholder="Escribe respuesta o /..."
                  disabled={isSending}
                  className="flex-1 min-w-0 bg-sf bd rounded-xl px-3 py-2 text-base sm:text-xs outline-none focus:border-[var(--ac)] disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isSending || (!inputText.trim() && !pendingAttachment)}
                  className="bg-[var(--tx)] text-[var(--cd)] px-3 sm:px-3.5 py-2 rounded-xl hover:opacity-85 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5 text-xs font-bold shrink-0"
                >
                  {isSending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  <span className="hidden sm:inline">Enviar</span>
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-xs tx-mu bg-cd h-full gap-2 p-6 text-center">
              <MessageSquare size={28} className="opacity-30" />
              <p className="font-semibold text-[var(--tx)]">Selecciona una conversación de WhatsApp</p>
              <p className="max-w-sm opacity-75">
                Gestiona las ventas de Bot Todd, envía fotos del catálogo, revisa el riesgo antifraude y crea pedidos directo desde el chat.
              </p>
            </div>
          )}
        </div>

        {/* 3. COLUMNA DERECHA: CONTEXTO DEL CLIENTE, TODD & PEDIDOS */}
        {selectedConv && (mobileShowContext || showContextPanel) && (
          <div
            className={`${mobileShowContext ? 'flex flex-1 min-h-0' : 'hidden'} ${
              showContextPanel ? 'lg:flex' : 'lg:hidden'
            } w-full lg:w-[260px] xl:w-[290px] lg:border-l border-[var(--bd)] bg-cd flex-col overflow-y-auto overflow-x-hidden p-3.5 gap-3.5 shrink-0`}
          >
            {/* Header móvil para volver al chat */}
            <div className="lg:hidden flex items-center justify-between gap-2 pb-2 border-b border-[var(--bd)] shrink-0">
              <button
                type="button"
                onClick={() => setMobileShowContext(false)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sf border border-[var(--bd)] text-xs font-bold"
              >
                <ChevronLeft size={15} /> Volver al chat
              </button>
              <button
                type="button"
                onClick={() => setShowOrderModal(true)}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center gap-1"
              >
                <ShoppingBag size={13} /> Crear Pedido
              </button>
            </div>
            {/* Semáforo Antifraude */}
            <div className="p-3 rounded-xl bg-sf border border-[var(--bd)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider tx-mu">
                  Riesgo Antifraude
                </span>
                {selectedRisk && (
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                      selectedRisk.nivelRiesgo === 'rojo'
                        ? 'bg-rose-600 text-white'
                        : selectedRisk.nivelRiesgo === 'amarillo'
                        ? 'bg-amber-500 text-zinc-950'
                        : selectedRisk.nivelRiesgo === 'verde'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-cd border border-[var(--bd)] tx-mu'
                    }`}
                  >
                    Score {selectedRisk.score}/100
                  </span>
                )}
              </div>

              {!selectedRisk ? (
                <p className="text-[11px] tx-mu">
                  Contacto con ID <strong>@lid</strong> sin teléfono de 8 dígitos vinculado aún. Edita el teléfono arriba si te lo da en el chat.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    <div className="p-1.5 rounded-lg bg-cd border border-[var(--bd)]">
                      <div className="text-xs font-black">{selectedRisk.totalPedidos}</div>
                      <div className="text-[9px] tx-mu">Pedidos</div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-cd border border-[var(--bd)]">
                      <div className="text-xs font-black text-emerald-500">{selectedRisk.entregados}</div>
                      <div className="text-[9px] tx-mu">Entreg.</div>
                    </div>
                    <div className="p-1.5 rounded-lg bg-cd border border-[var(--bd)]">
                      <div className="text-xs font-black text-rose-500">{selectedRisk.cancelados}</div>
                      <div className="text-[9px] tx-mu">Canc.</div>
                    </div>
                  </div>
                  <p className="text-[10px] tx-mu leading-snug">{selectedRisk.recomendacion}</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedRisk.enListaNegra) {
                        removeBlacklistEntry(selectedRisk.telefonoLimpio);
                        showBanner('ok', 'Cliente rehabilitado de la lista negra.');
                      } else {
                        addOrUpdateBlacklist({
                          telefono: selectedRisk.telefonoLimpio,
                          nombreCliente: selectedConv.contact_name || 'Cliente WhatsApp',
                          aliasNombres: selectedConv.contact_name ? [selectedConv.contact_name] : [],
                          motivo: 'Reportado desde UniChat',
                          severidad: 'alta',
                          reportadoPor: 'UniChat',
                          fecha: new Date().toISOString(),
                        });
                        showBanner('ok', 'Cliente agregado a Lista Negra COD.');
                      }
                      setBlacklistTick(t => t + 1);
                    }}
                    className={`w-full py-1.5 rounded-lg text-[10px] font-bold border flex items-center justify-center gap-1 transition-colors ${
                      selectedRisk.enListaNegra
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20'
                    }`}
                  >
                    <UserX size={11} />
                    {selectedRisk.enListaNegra ? 'Rehabilitar de Lista Negra' : 'Boletinar en Lista Negra'}
                  </button>
                </>
              )}
            </div>

            {/* Estado de Bot Todd */}
            <div className="p-3 rounded-xl bg-sf border border-[var(--bd)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider tx-mu flex items-center gap-1">
                  <Bot size={11} className="text-purple-500" /> Estado Bot Todd
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cd border border-[var(--bd)]">
                  {whatsappState?.paso_actual || 'inicio'}
                </span>
              </div>

              {whatsappState ? (
                <div className="space-y-1 text-[11px]">
                  {whatsappState.last_sku && (
                    <div className="flex justify-between gap-2">
                      <span className="tx-mu">Producto:</span>
                      <span className="font-mono font-bold truncate">{whatsappState.last_sku}</span>
                    </div>
                  )}
                  {whatsappState.last_sku &&
                    toddSettings.productVideos[whatsappState.last_sku.toUpperCase()] && (
                      <button
                        type="button"
                        disabled={isSending}
                        onClick={() =>
                          handleSendCatalogVideo(
                            whatsappState.last_nombre || whatsappState.last_sku || 'Producto',
                            toddSettings.productVideos[whatsappState.last_sku!.toUpperCase()]
                          )
                        }
                        className="w-full py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-600 text-rose-600 dark:text-rose-400 hover:text-white border border-rose-500/30 text-[10px] font-bold flex items-center justify-center gap-1 transition-colors"
                      >
                        <Video size={11} /> Enviar Video How-To
                      </button>
                    )}
                  {whatsappState.nombre_cliente && (
                    <div className="flex justify-between gap-2">
                      <span className="tx-mu">Nombre:</span>
                      <span className="font-semibold truncate">{whatsappState.nombre_cliente}</span>
                    </div>
                  )}
                  {whatsappState.direccion && (
                    <div className="text-[10px] tx-mu bg-cd p-1.5 rounded-lg border border-[var(--bd)]">
                      📍 {whatsappState.direccion}
                    </div>
                  )}
                  {detectedAdTag && (
                    <div className="text-[10px] text-indigo-500 font-bold">
                      📣 Anuncio: {detectedAdTag}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleResetToddState}
                    className="w-full mt-1 py-1.5 rounded-lg border border-[var(--bd)] bg-cd hover:border-purple-500 text-[10px] font-bold flex items-center justify-center gap-1"
                  >
                    <RotateCcw size={11} /> Reiniciar flujo de Todd
                  </button>
                </div>
              ) : (
                <p className="text-[11px] tx-mu">Sin estado previo guardado en whatsapp_state.</p>
              )}
            </div>

            {/* Últimos Pedidos del Cliente */}
            <div className="p-3 rounded-xl bg-sf border border-[var(--bd)] space-y-2 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider tx-mu">
                  Historial de Pedidos ({selectedOrders.length})
                </span>
                <Link to="/pedidos" className="text-[10px] font-bold text-[var(--ac)] hover:underline">
                  Ver todos
                </Link>
              </div>

              {selectedOrders.length === 0 ? (
                <div className="text-center py-4 space-y-2">
                  <p className="text-[11px] tx-mu">Sin pedidos previos con este teléfono.</p>
                  <button
                    type="button"
                    onClick={() => setShowOrderModal(true)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold inline-flex items-center gap-1"
                  >
                    <Plus size={12} /> Crear primer pedido
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {selectedOrders.map(ord => (
                    <div key={ord.id} className="p-2 rounded-lg bg-cd border border-[var(--bd)] text-[11px] space-y-0.5">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono font-bold text-[10px] uppercase">
                          {ord.estado || 'nuevo'}
                        </span>
                        <span className="font-bold text-emerald-500">${Number(ord.total || 0).toFixed(2)}</span>
                      </div>
                      <div className="truncate font-medium">{ord.sku || ord.catalogo_sku || 'Producto'}</div>
                      <div className="text-[9px] tx-mu">
                        {ord.created_at ? new Date(ord.created_at).toLocaleDateString('es-SV') : ''}
                        {ord.motivo_cancelacion ? ` · ❌ ${ord.motivo_cancelacion}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* LIGHTBOX PARA ZOOM DE IMÁGENES / COMPROBANTES */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[95] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/15 text-white hover:bg-white/25"
          >
            <X size={20} />
          </button>
          <img
            src={lightboxUrl}
            alt="Vista ampliada"
            className="max-w-full max-h-[88vh] rounded-2xl shadow-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* MODAL CONFIGURADOR DE RESPUESTAS RÁPIDAS COD */}
      {showQrModal && (
        <div
          className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowQrModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-cd border border-[var(--bd)] p-5 space-y-4 max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Zap size={16} className="text-amber-500" /> Respuestas Rápidas COD (Atajos `/`)
              </h3>
              <button onClick={() => setShowQrModal(false)} className="p-1 rounded-lg hover:bg-sf">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-2">
              {quickReplies.map(qr => (
                <div key={qr.id} className="p-2.5 rounded-xl bg-sf border border-[var(--bd)] flex items-start justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-bold flex items-center gap-2">
                      <span>{qr.label}</span>
                      <span className="font-mono text-[10px] text-indigo-500">{qr.command}</span>
                    </div>
                    <p className="text-[11px] tx-mu whitespace-pre-wrap mt-0.5">{qr.text}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteQuickReply(qr.id)}
                    className="p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            <form onSubmit={handleAddQuickReply} className="pt-3 border-t border-[var(--bd)] space-y-2.5">
              <div className="text-[11px] font-bold">Agregar nueva plantilla (usa {'{nombre}'} para personalizar)</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newQrLabel}
                  onChange={e => setNewQrLabel(e.target.value)}
                  placeholder="Etiqueta (ej. 💳 Chivo / QR)"
                  className="px-3 py-1.5 rounded-lg bg-sf border border-[var(--bd)] text-xs outline-none"
                  required
                />
                <input
                  type="text"
                  value={newQrCommand}
                  onChange={e => setNewQrCommand(e.target.value)}
                  placeholder="Comando (ej. /chivo)"
                  className="px-3 py-1.5 rounded-lg bg-sf border border-[var(--bd)] text-xs font-mono outline-none"
                />
              </div>
              <textarea
                rows={3}
                value={newQrText}
                onChange={e => setNewQrText(e.target.value)}
                placeholder="Texto de la respuesta rápida..."
                className="w-full px-3 py-2 rounded-lg bg-sf border border-[var(--bd)] text-xs outline-none resize-none"
                required
              />
              <button
                type="submit"
                className="w-full py-2 rounded-xl bg-[var(--tx)] text-[var(--cd)] text-xs font-bold"
              >
                + Guardar Plantilla
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CREAR PEDIDO DIRECTO DESDE UNICHAT */}
      {showOrderModal && selectedConv && (
        <PedidoModal
          onClose={() => setShowOrderModal(false)}
          onSaved={() => {
            loadConversations(true);
            showBanner('ok', 'Pedido creado desde UniChat y registrado en Pedidos.');
          }}
          pedidosExistentes={allOrders}
          initialValues={orderInitialValues}
        />
      )}

      {/* MODAL CONFIRMAR ELIMINACIÓN DE CHAT INDIVIDUAL */}
      {chatToDelete && (
        <div
          className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !isDeletingChat && setChatToDelete(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-cd border border-[var(--bd)] p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-rose-500 shrink-0">
                  <Trash2 size={17} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[var(--tx)]">Eliminar conversación</h3>
                  <p className="text-[11px] tx-mu">Esta acción no se puede deshacer</p>
                </div>
              </div>
              <button
                type="button"
                disabled={isDeletingChat}
                onClick={() => setChatToDelete(null)}
                className="p-1 rounded-lg hover:bg-sf tx-mu disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-sf border border-[var(--bd)] space-y-1">
              <div className="text-xs font-bold text-[var(--tx)] truncate">
                {chatToDelete.contact_name || formatPhoneDisplay(chatToDelete)}
              </div>
              <div className="text-[11px] font-mono tx-mu truncate">
                {formatPhoneDisplay(chatToDelete)}
              </div>
              {chatToDelete.last_message && (
                <div className="text-[11px] tx-mu truncate pt-1 border-t border-[var(--bd)]">
                  Último mensaje: {chatToDelete.last_message}
                </div>
              )}
            </div>

            <p className="text-xs tx-mu leading-relaxed">
              Se eliminará el chat y todo su historial de mensajes de UniChat.{' '}
              <strong className="text-[var(--tx)]">Los pedidos ya guardados en Pedidos se conservarán</strong>. Si el cliente vuelve a escribir por WhatsApp, se creará un chat nuevo.
            </p>

            <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-sf border border-[var(--bd)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={clearToddOnDelete}
                onChange={e => setClearToddOnDelete(e.target.checked)}
                disabled={isDeletingChat}
                className="mt-0.5 accent-rose-600 rounded"
              />
              <span className="text-[11px] leading-snug">
                <strong className="block text-[var(--tx)]">Reiniciar también la memoria de Bot Todd</strong>
                <span className="tx-mu">Limpia el flujo anterior para que Todd lo atienda desde cero si vuelve a escribir.</span>
              </span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isDeletingChat}
                onClick={() => setChatToDelete(null)}
                className="px-3.5 py-2 rounded-xl border border-[var(--bd)] bg-sf hover:bg-cd text-xs font-bold disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeletingChat}
                onClick={handleConfirmDeleteChat}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
              >
                {isDeletingChat ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {isDeletingChat ? 'Eliminando...' : 'Eliminar chat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
