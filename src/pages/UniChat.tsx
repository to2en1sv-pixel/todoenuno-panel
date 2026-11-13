import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
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
  ShieldAlert,
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

type OrderSummary = {
  telefono: string;
  total: number;
  entregados: number;
  cancelados: number;
};

function cleanDigits8(raw?: string | null): string {
  const digits = String(raw || '').split('@')[0].replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : digits;
}

function formatPhoneDisplay(conv: Conversation): string {
  const raw = conv.contact_phone || conv.id || '';
  if (!raw) return 'Sin número';
  if (raw.includes('@lid')) return 'WhatsApp ID (@lid)';
  const digits = raw.split('@')[0].replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('503')) {
    return `+503 ${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 8) {
    return `+503 ${digits.slice(0, 4)}-${digits.slice(4)}`;
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

export function UniChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | 'bot' | 'human'>('all');
  const [orderSummaryMap, setOrderSummaryMap] = useState<Record<string, OrderSummary>>({});

  const [isUpdating, setIsUpdating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [inputText, setInputText] = useState('');
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  const showBanner = (type: 'ok' | 'err', text: string) => {
    setBanner({ type, text });
    setTimeout(() => {
      setBanner(prev => (prev?.text === text ? null : prev));
    }, 5000);
  };

  const loadConversations = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const [{ data: convData }, { data: ordData }] = await Promise.all([
        supabase.from('bb_conversations').select('*').order('updated_at', { ascending: false }),
        supabase.from('whatsapp_orders').select('telefono, estado'),
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
        const map: Record<string, OrderSummary> = {};
        ordData.forEach((o: any) => {
          const p8 = cleanDigits8(o.telefono);
          if (p8.length < 8) return;
          if (!map[p8]) {
            map[p8] = { telefono: p8, total: 0, entregados: 0, cancelados: 0 };
          }
          map[p8].total += 1;
          const est = String(o.estado || '').toLowerCase();
          if (est === 'entregado') map[p8].entregados += 1;
          if (est === 'cancelado') map[p8].cancelados += 1;
        });
        setOrderSummaryMap(map);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 1. Carga inicial y suscripción Realtime a Supabase
  useEffect(() => {
    loadConversations();

    const channel = supabase
      .channel('crm_updates_evolution')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bb_conversations' }, () => {
        loadConversations();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bb_messages' }, payload => {
        const newMsg = payload.new as Message;
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

  // 2. Cargar mensajes al cambiar conversación
  const loadMessagesFor = useCallback(async (convId: string) => {
    const { data } = await supabase
      .from('bb_messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data as Message[]);
  }, []);

  useEffect(() => {
    if (!selectedConv?.id) {
      setMessages([]);
      return;
    }
    loadMessagesFor(selectedConv.id);
  }, [selectedConv?.id, loadMessagesFor]);

  // Auto-scroll al último mensaje
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedConv?.id]);

  // Contadores y filtros laterales
  const counts = useMemo(() => {
    let bot = 0;
    let human = 0;
    conversations.forEach(c => {
      if (c.status === 'human') human++;
      else bot++;
    });
    return { total: conversations.length, bot, human };
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      const isHuman = c.status === 'human';
      if (modeFilter === 'bot' && isHuman) return false;
      if (modeFilter === 'human' && !isHuman) return false;

      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return (
        (c.contact_name || '').toLowerCase().includes(q) ||
        (c.contact_phone || '').toLowerCase().includes(q) ||
        (c.last_message || '').toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      );
    });
  }, [conversations, modeFilter, search]);

  const selectedRisk = useMemo(() => {
    if (!selectedConv) return null;
    const p8 = cleanDigits8(selectedConv.contact_phone || selectedConv.id);
    return p8.length >= 8 ? orderSummaryMap[p8] || null : null;
  }, [selectedConv, orderSummaryMap]);

  // 3. Alternar Bot Todd / Modo Humano
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
        // Si en vista previa local no hay serverless /api/*, fallback directo a Supabase
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

      try {
        const { emitOsEvent } = await import('@/lib/osEvents');
        await emitOsEvent({
          type: 'chat.bot.toggled',
          source_table: 'bb_conversations',
          source_id: selectedConv.id,
          payload: {
            conversation_id: selectedConv.id,
            contact_name: selectedConv.contact_name,
            contact_phone: selectedConv.contact_phone,
            status: newStatus,
            engine: 'evolution-v2',
          },
        });
      } catch {}
    } catch (error: any) {
      console.error(error);
      showBanner('err', `No se pudo cambiar el modo: ${error?.message || 'Error desconocido'}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // 4. Enviar respuesta manual vía Evolution API v2.3.7
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedConv || isSending) return;

    const textToSend = inputText.trim();
    setInputText('');
    setIsSending(true);

    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selectedConv.id,
          text: textToSend,
          instanceId: selectedConv.instance_id || 'eee',
          contactPhone: selectedConv.contact_phone || selectedConv.id,
          pauseBot: true,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(
          'El endpoint /api/send-message requiere despliegue en Vercel o variables EVOLUTION_API_URL / EVOLUTION_API_KEY.'
        );
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || 'Error enviando por Evolution');

      const optimisticId = String(data.messageId || `local-${Date.now()}`);
      const nowIso = new Date().toISOString();

      setMessages(prev => {
        if (prev.some(m => m.id === optimisticId)) return prev;
        return [
          ...prev,
          {
            id: optimisticId,
            conversation_id: selectedConv.id,
            body: textToSend,
            from_me: true,
            created_at: nowIso,
            telefono_real: selectedConv.contact_phone,
          },
        ];
      });

      const updatedConv: Conversation = {
        ...selectedConv,
        last_message: textToSend,
        updated_at: nowIso,
        status: 'human',
      };
      setSelectedConv(updatedConv);
      setConversations(prev =>
        prev.map(c => (c.id === selectedConv.id ? updatedConv : c))
      );

      try {
        const { emitOsEvent } = await import('@/lib/osEvents');
        await emitOsEvent({
          type: 'chat.message.sent',
          source_table: 'bb_messages',
          source_id: selectedConv.id,
          payload: {
            conversation_id: selectedConv.id,
            contact_name: selectedConv.contact_name,
            contact_phone: selectedConv.contact_phone,
            text: textToSend,
            agent_type: 'human',
            engine: 'evolution-v2',
          },
        });
      } catch {}
    } catch (error: any) {
      console.error('Error al enviar:', error);
      setInputText(textToSend);
      showBanner('err', `No se pudo enviar el mensaje: ${error?.message || 'Error de conexión'}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 h-[calc(100vh-110px)]">
      {/* Notificación inline */}
      {banner && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 ${
            banner.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-500'
          }`}
        >
          <span className="flex items-center gap-2">
            {banner.type === 'ok' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {banner.text}
          </span>
          <button onClick={() => setBanner(null)} className="opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row flex-1 min-h-0 bg-cd bd rounded-2xl overflow-hidden shadow-sm">
        {/* Lista de Chats (Izquierda) */}
        <div
          className={`w-full lg:w-[330px] border-r border-[var(--bd)] flex-col min-h-0 ${
            selectedConv ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="p-3.5 border-b border-[var(--bd)] bg-sf space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquare size={17} className="text-emerald-500" />
                <h2 className="font-black text-sm tracking-tight">UniChat · WhatsApp</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Evolution 2.3
                </span>
              </div>
              <button
                onClick={() => loadConversations(true)}
                title="Recargar conversaciones"
                className="p-1.5 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf transition-colors"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Buscador */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 tx-mu" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar cliente, teléfono o mensaje..."
                className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-cd border border-[var(--bd)] text-xs outline-none focus:border-[var(--ac)]"
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

            {/* Filtros Bot / Humano */}
            <div className="grid grid-cols-3 gap-1 p-0.5 bg-cd rounded-xl border border-[var(--bd)] text-[10px] font-bold">
              <button
                type="button"
                onClick={() => setModeFilter('all')}
                className={`py-1 rounded-lg transition-colors ${
                  modeFilter === 'all' ? 'bg-[var(--tx)] text-[var(--cd)]' : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                Todos ({counts.total})
              </button>
              <button
                type="button"
                onClick={() => setModeFilter('bot')}
                className={`py-1 rounded-lg transition-colors flex items-center justify-center gap-1 ${
                  modeFilter === 'bot' ? 'bg-purple-600 text-white' : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                <Bot size={11} /> Todd ({counts.bot})
              </button>
              <button
                type="button"
                onClick={() => setModeFilter('human')}
                className={`py-1 rounded-lg transition-colors flex items-center justify-center gap-1 ${
                  modeFilter === 'human' ? 'bg-amber-500 text-zinc-950' : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                <User size={11} /> Humano ({counts.human})
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
                <p>No hay conversaciones en este filtro todavía.</p>
                <p className="text-[11px] opacity-80 leading-relaxed">
                  Apunta Evolution v2.3.7 o tu n8n a{' '}
                  <code className="px-1.5 py-0.5 rounded bg-sf border border-[var(--bd)] font-mono">
                    /api/evolution-webhook
                  </code>{' '}
                  para ver los chats en vivo aquí.
                </p>
              </div>
            ) : (
              filteredConversations.map(conv => {
                const isHuman = conv.status === 'human';
                const p8 = cleanDigits8(conv.contact_phone || conv.id);
                const ordInfo = p8.length >= 8 ? orderSummaryMap[p8] : undefined;

                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConv(conv)}
                    className={`p-3 border-b border-[var(--bd)] cursor-pointer hover:bg-sf/70 transition-colors ${
                      selectedConv?.id === conv.id ? 'bg-sf border-l-4 border-l-[var(--ac)]' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <div className="min-w-0">
                        <span className="font-bold text-xs block truncate text-[var(--tx)]">
                          {conv.contact_name || formatPhoneDisplay(conv)}
                        </span>
                        <span className="text-[10px] font-mono tx-mu block truncate">
                          {formatPhoneDisplay(conv)}
                        </span>
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
                          <span className="text-[9px] font-bold text-emerald-600">
                            {ordInfo.entregados > 0 ? `✓ ${ordInfo.entregados} ped.` : `${ordInfo.total} ped.`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-[11px] tx-mu truncate">{conv.last_message || 'Sin mensajes'}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Ventana de Chat (Derecha) */}
        <div className={`flex-1 flex-col bg-sf min-h-0 ${selectedConv ? 'flex' : 'hidden lg:flex'}`}>
          {selectedConv ? (
            <>
              {/* Header del Chat */}
              <div className="p-3.5 border-b border-[var(--bd)] bg-cd flex flex-wrap justify-between items-center gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    onClick={() => setSelectedConv(null)}
                    className="lg:hidden p-1.5 bg-sf border border-[var(--bd)] rounded-lg tx-mu hover:text-[var(--tx)] transition-colors"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm truncate">
                        {selectedConv.contact_name || formatPhoneDisplay(selectedConv)}
                      </h3>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sf border border-[var(--bd)] tx-mu">
                        {selectedConv.instance_id || 'eee'}
                      </span>
                      {selectedRisk && (
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                            selectedRisk.cancelados >= 2
                              ? 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                              : selectedRisk.entregados > 0
                              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                          }`}
                        >
                          {selectedRisk.cancelados >= 2 && <ShieldAlert size={10} />}
                          {selectedRisk.entregados} entreg. · {selectedRisk.cancelados} canc.
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono tx-mu flex items-center gap-1 mt-0.5">
                      <Phone size={10} /> {formatPhoneDisplay(selectedConv)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    to="/pedidos"
                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-[var(--bd)] bg-sf hover:bg-cd flex items-center gap-1.5 transition-colors"
                    title="Ir al módulo de Pedidos"
                  >
                    <ShoppingBag size={13} />
                    <span className="hidden sm:inline">Pedidos</span>
                  </Link>

                  <button
                    onClick={toggleStatus}
                    disabled={isUpdating}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                      selectedConv.status === 'human'
                        ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-sm'
                        : 'bg-purple-600 text-white hover:bg-purple-500 shadow-sm'
                    } ${isUpdating ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    {isUpdating ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span className="hidden sm:inline">Cambiando...</span>
                      </>
                    ) : selectedConv.status === 'human' ? (
                      <>
                        <User size={14} />
                        <span>Modo Humano (Reactivar Todd)</span>
                      </>
                    ) : (
                      <>
                        <Bot size={14} />
                        <span>Todd Activo (Pausar)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Aviso contextual si Todd está activo */}
              {selectedConv.status !== 'human' && (
                <div className="px-4 py-1.5 bg-purple-500/10 border-b border-purple-500/20 text-[11px] text-purple-600 dark:text-purple-300 flex items-center justify-between gap-2">
                  <span>
                    🤖 <strong>Bot Todd</strong> está atendiendo este chat. Si escribes un mensaje abajo, Todd se pausará automáticamente para que atiendas tú.
                  </span>
                </div>
              )}

              {/* Mensajes */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5 bg-cd">
                {messages.length === 0 ? (
                  <div className="m-auto text-xs tx-mu">No hay mensajes registrados en esta conversación.</div>
                ) : (
                  messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`max-w-[85%] sm:max-w-[70%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                        msg.from_me
                          ? 'self-end bg-[var(--tx)] text-[var(--cd)] rounded-br-sm'
                          : 'self-start bg-sf border border-[var(--bd)] text-[var(--tx)] rounded-bl-sm'
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{msg.body}</div>
                      {msg.created_at && (
                        <div className="text-[9px] opacity-60 mt-1 text-right font-mono">
                          {formatMessageTime(msg.created_at)}
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input de Respuesta Humana */}
              <form onSubmit={handleSendMessage} className="p-3 bg-cd border-t border-[var(--bd)] flex gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  placeholder="Escribe respuesta manual por WhatsApp (pausa a Todd automáticamente)..."
                  disabled={isSending}
                  className="flex-1 bg-sf bd rounded-xl px-3.5 py-2 text-xs outline-none focus:border-[var(--ac)] disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isSending || !inputText.trim()}
                  className="bg-[var(--tx)] text-[var(--cd)] px-3.5 py-2 rounded-xl hover:opacity-85 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5 text-xs font-bold shrink-0"
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
                Aquí verás en tiempo real lo que conversa Bot Todd con tus clientes y podrás tomar el control humano con un clic.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
