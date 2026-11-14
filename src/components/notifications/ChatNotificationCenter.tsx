import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  BellOff,
  Bot,
  MessageSquare,
  Monitor,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

type ConversationMeta = {
  id: string;
  instance_id?: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  last_message?: string | null;
  status: string | null;
  updated_at?: string | null;
};

type IncomingMessageRow = {
  id: string;
  conversation_id: string;
  body: string;
  from_me: boolean;
  created_at: string;
  telefono_real?: string | null;
};

export type ToastNotification = {
  id: string;
  conversationId: string;
  senderName: string;
  senderPhone: string | null;
  mode: 'bot' | 'human';
  preview: string;
  createdAt: string;
  isTest?: boolean;
};

type ChatNotificationContextValue = {
  unreadCount: number;
  soundEnabled: boolean;
  desktopEnabled: boolean;
  desktopPermission: NotificationPermission | 'unsupported';
  toggleSound: () => void;
  toggleDesktopNotifications: () => Promise<void>;
  triggerTestNotification: () => void;
};

const SOUND_KEY = 'unichat_notif_sound_v1';
const DESKTOP_KEY = 'unichat_notif_desktop_v1';
const TOAST_TTL_MS = 10000;
const MAX_VISIBLE_TOASTS = 3;

const ChatNotificationContext = createContext<ChatNotificationContextValue | null>(null);

export function useChatNotifications(): ChatNotificationContextValue {
  const ctx = useContext(ChatNotificationContext);
  if (!ctx) {
    return {
      unreadCount: 0,
      soundEnabled: true,
      desktopEnabled: false,
      desktopPermission: 'unsupported',
      toggleSound: () => {},
      toggleDesktopNotifications: async () => {},
      triggerTestNotification: () => {},
    };
  }
  return ctx;
}

function isLegacyConversationMeta(conv?: ConversationMeta | null): boolean {
  if (!conv) return false;
  const inst = String(conv.instance_id || '').toLowerCase();
  if (inst === 'builderbot-principal' || inst === 'ventas' || inst === 'builderbot') {
    return true;
  }
  const hasHexId = /^[0-9a-f]{20,}$/i.test(conv.id);
  const placeholderMsg = (conv.last_message || '').trim() === 'Haz clic para ver los mensajes';
  return hasHexId && placeholderMsg;
}

function formatPhone(conv?: Partial<ConversationMeta> | null, fallbackId?: string): string {
  const raw = conv?.contact_phone || conv?.id || fallbackId || '';
  if (!raw) return 'WhatsApp';
  if (raw.includes('@lid')) return `WhatsApp LID (${raw.split('@')[0]})`;
  const digits = raw.split('@')[0].replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('503')) {
    return `+503 ${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 8) {
    return `+503 ${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  if (digits.length >= 14 && (conv?.id || fallbackId || '').includes('@lid')) {
    return `WhatsApp LID (${digits})`;
  }
  return raw.split('@')[0] || 'WhatsApp';
}

function formatMessagePreview(rawBody: string): string {
  const body = (rawBody || '').trim();
  if (!body) return 'Nuevo mensaje recibido';

  const imgMatch = body.match(/^\[IMG:https?:\/\/[^\]]+\]\s*([\s\S]*)$/i);
  if (imgMatch) {
    const caption = imgMatch[1].trim();
    return caption ? `📷 Imagen · ${caption}` : '📷 Imagen recibida';
  }
  if (body.startsWith('📷 [Imagen]')) {
    const rest = body.replace(/^📷 \[Imagen\]\s*/i, '').trim();
    return rest ? `📷 Imagen · ${rest}` : '📷 Imagen recibida';
  }
  if (body.startsWith('🎤 [Nota de voz]')) {
    const rest = body.replace(/^🎤 \[Nota de voz\]\s*/i, '').trim();
    return rest ? `🎤 Nota de voz · ${rest}` : '🎤 Nota de voz recibida';
  }
  if (body.startsWith('🎥 [Video]')) {
    const rest = body.replace(/^🎥 \[Video\]\s*/i, '').trim();
    return rest ? `🎥 Video · ${rest}` : '🎥 Video recibido';
  }

  return body.replace(/\s+/g, ' ');
}

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'Ahora';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return 'Ahora';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  return new Date(ts).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  if (!cleaned) return 'WA';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function playNotificationChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const notes = [
      { freq: 659.25, start: 0, dur: 0.11 },
      { freq: 880.0, start: 0.09, dur: 0.16 },
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);

      gain.gain.setValueAtTime(0.0001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(0.065, now + note.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.02);
    }

    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 500);
  } catch {
    // Silencioso si el navegador aún bloquea audio automático
  }
}

export function ChatNotificationProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const [conversationsMap, setConversationsMap] = useState<Record<string, ConversationMeta>>({});
  const [lastMsgFromMeMap, setLastMsgFromMeMap] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const conversationsRef = useRef<Record<string, ConversationMeta>>({});
  conversationsRef.current = conversationsMap;

  const seenMsgIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const bootIsoRef = useRef(new Date(Date.now() - 2000).toISOString());
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const hoveredIdsRef = useRef<Set<string>>(new Set());

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(SOUND_KEY);
    return saved === null ? true : saved === 'true';
  });
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const [desktopPermission, setDesktopPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  const [desktopEnabled, setDesktopEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    return localStorage.getItem(DESKTOP_KEY) === 'true' && Notification.permission === 'granted';
  });
  const desktopEnabledRef = useRef(desktopEnabled);
  desktopEnabledRef.current = desktopEnabled;

  const dismissToast = useCallback((id: string) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    hoveredIdsRef.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const scheduleDismiss = useCallback(
    (id: string, delayMs = TOAST_TTL_MS) => {
      if (timersRef.current[id]) {
        clearTimeout(timersRef.current[id]);
      }
      timersRef.current[id] = setTimeout(() => {
        if (!hoveredIdsRef.current.has(id)) {
          dismissToast(id);
        }
      }, delayMs);
    },
    [dismissToast]
  );

  const enqueueToast = useCallback(
    (toast: ToastNotification) => {
      setToasts(prev => {
        const filtered = prev.filter(t => t.id !== toast.id);
        const next = [toast, ...filtered].slice(0, MAX_VISIBLE_TOASTS);
        const keptIds = new Set(next.map(t => t.id));
        for (const old of prev) {
          if (!keptIds.has(old.id) && timersRef.current[old.id]) {
            clearTimeout(timersRef.current[old.id]);
            delete timersRef.current[old.id];
          }
        }
        return next;
      });
      scheduleDismiss(toast.id);
    },
    [scheduleDismiss]
  );

  const openChatFromToast = useCallback(
    (toast: ToastNotification) => {
      setToasts(prev => {
        for (const item of prev) {
          if (item.conversationId === toast.conversationId || item.id === toast.id) {
            if (timersRef.current[item.id]) {
              clearTimeout(timersRef.current[item.id]);
              delete timersRef.current[item.id];
            }
          }
        }
        return prev.filter(item => item.conversationId !== toast.conversationId && item.id !== toast.id);
      });

      if (toast.isTest || toast.conversationId === '__test__') {
        navigate('/unichat');
        return;
      }
      navigate(`/unichat?chat=${encodeURIComponent(toast.conversationId)}`);
    },
    [navigate]
  );

  const showOSNotification = useCallback(
    (toast: ToastNotification) => {
      if (
        !desktopEnabledRef.current ||
        typeof window === 'undefined' ||
        !('Notification' in window) ||
        Notification.permission !== 'granted'
      ) {
        return;
      }
      if (document.visibilityState === 'visible' && pathnameRef.current === '/unichat') {
        return;
      }

      try {
        const notif = new Notification(`${toast.senderName} · UniChat`, {
          body: toast.preview,
          tag: `unichat-${toast.conversationId}`,
        });
        notif.onclick = () => {
          window.focus();
          openChatFromToast(toast);
          notif.close();
        };
      } catch {
        // Ignorar si el navegador restringe Notification constructor
      }
    },
    [openChatFromToast]
  );

  const notifyForIncomingMessage = useCallback(
    async (msg: IncomingMessageRow, convMapOverride?: Record<string, ConversationMeta>) => {
      if (!msg || !msg.conversation_id || msg.from_me) return;

      const dedupeKey = msg.id || `${msg.conversation_id}:${msg.created_at}:${msg.body}`;
      if (seenMsgIdsRef.current.has(dedupeKey)) return;
      seenMsgIdsRef.current.add(dedupeKey);
      if (seenMsgIdsRef.current.size > 400) {
        const first = seenMsgIdsRef.current.values().next().value;
        if (first) seenMsgIdsRef.current.delete(first);
      }

      let conv = convMapOverride?.[msg.conversation_id] || conversationsRef.current[msg.conversation_id];
      if (!conv) {
        try {
          const { data } = await supabase
            .from('bb_conversations')
            .select('id,instance_id,contact_name,contact_phone,last_message,status,updated_at')
            .eq('id', msg.conversation_id)
            .maybeSingle();
          if (data) {
            conv = data as ConversationMeta;
            setConversationsMap(prev => ({ ...prev, [conv!.id]: conv! }));
          }
        } catch {
          // Seguir con fallback si falla
        }
      }

      if (isLegacyConversationMeta(conv)) return;

      const formattedPhone = formatPhone(conv, msg.telefono_real || msg.conversation_id);
      const senderName = conv?.contact_name?.trim() || formattedPhone;
      const senderPhone = conv?.contact_name?.trim() ? formattedPhone : null;
      const mode: 'bot' | 'human' = conv?.status === 'human' ? 'human' : 'bot';

      const toast: ToastNotification = {
        id: dedupeKey,
        conversationId: msg.conversation_id,
        senderName,
        senderPhone,
        mode,
        preview: formatMessagePreview(msg.body),
        createdAt: msg.created_at || new Date().toISOString(),
      };

      const isInsideUniChat = pathnameRef.current === '/unichat';
      const isTabHidden = typeof document !== 'undefined' && document.visibilityState !== 'visible';

      if (!isInsideUniChat) {
        enqueueToast(toast);
        if (soundEnabledRef.current) {
          playNotificationChime();
        }
      } else if (isTabHidden && soundEnabledRef.current) {
        playNotificationChime();
      }

      if (isTabHidden || !isInsideUniChat) {
        showOSNotification(toast);
      }
    },
    [enqueueToast, showOSNotification]
  );

  const syncUnreadAndConversations = useCallback(async () => {
    try {
      const [{ data: convData }, { data: recentMsgs }] = await Promise.all([
        supabase
          .from('bb_conversations')
          .select('id,instance_id,contact_name,contact_phone,last_message,status,updated_at')
          .order('updated_at', { ascending: false }),
        supabase
          .from('bb_messages')
          .select('id,conversation_id,body,from_me,created_at,telefono_real')
          .order('created_at', { ascending: false })
          .limit(300),
      ]);

      const nextConvMap: Record<string, ConversationMeta> = {};
      if (Array.isArray(convData)) {
        for (const c of convData as ConversationMeta[]) {
          if (c.id) nextConvMap[c.id] = c;
        }
        setConversationsMap(nextConvMap);
      }

      if (Array.isArray(recentMsgs)) {
        const msgs = recentMsgs as IncomingMessageRow[];
        const dirMap: Record<string, boolean> = {};
        for (const m of msgs) {
          if (m.conversation_id && dirMap[m.conversation_id] === undefined) {
            dirMap[m.conversation_id] = Boolean(m.from_me);
          }
        }
        setLastMsgFromMeMap(dirMap);

        if (!initializedRef.current) {
          // Primer arranque: registrar IDs existentes para no disparar tarjetas de mensajes viejos
          for (const m of msgs) {
            const key = m.id || `${m.conversation_id}:${m.created_at}:${m.body}`;
            seenMsgIdsRef.current.add(key);
          }
          initializedRef.current = true;
        } else {
          // Respaldo por polling cada 4s (garantiza tarjetas aunque Realtime de bb_messages no emita)
          const freshIncoming = msgs
            .filter(m => !m.from_me && m.created_at >= bootIsoRef.current)
            .slice(0, 10)
            .reverse();
          for (const m of freshIncoming) {
            const key = m.id || `${m.conversation_id}:${m.created_at}:${m.body}`;
            if (!seenMsgIdsRef.current.has(key)) {
              await notifyForIncomingMessage(m, nextConvMap);
            }
          }
        }
      }
    } catch {
      // Ignorar fallo transitorio de red
    }
  }, [notifyForIncomingMessage]);

  // Carga inicial, suscripción Realtime y polling rápido de respaldo (4s)
  useEffect(() => {
    void syncUnreadAndConversations();

    const channel = supabase
      .channel('global_unichat_notifications_v1')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bb_conversations' }, payload => {
        if (payload.eventType === 'DELETE') {
          const oldRow = payload.old as { id?: string } | null;
          if (oldRow?.id) {
            setConversationsMap(prev => {
              if (!(oldRow.id! in prev)) return prev;
              const copy = { ...prev };
              delete copy[oldRow.id!];
              return copy;
            });
            setLastMsgFromMeMap(prev => {
              if (!(oldRow.id! in prev)) return prev;
              const copy = { ...prev };
              delete copy[oldRow.id!];
              return copy;
            });
          }
          return;
        }

        const row = payload.new as ConversationMeta | null;
        if (row?.id) {
          setConversationsMap(prev => ({ ...prev, [row.id]: row }));
          // Si llegó un cambio en la conversación, verificar al instante si hay mensaje nuevo
          void syncUnreadAndConversations();
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bb_messages' }, payload => {
        const msg = payload.new as IncomingMessageRow;
        if (!msg || !msg.conversation_id) return;

        setLastMsgFromMeMap(prev => ({
          ...prev,
          [msg.conversation_id]: Boolean(msg.from_me),
        }));

        if (!msg.from_me) {
          void notifyForIncomingMessage(msg);
        }
      })
      .subscribe();

    const poll = setInterval(() => {
      void syncUnreadAndConversations();
    }, 4000);

    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
      for (const id of Object.keys(timersRef.current)) {
        clearTimeout(timersRef.current[id]);
      }
      timersRef.current = {};
    };
  }, [notifyForIncomingMessage, syncUnreadAndConversations]);

  const unreadCount = useMemo(() => {
    let count = 0;
    for (const [convId, fromMe] of Object.entries(lastMsgFromMeMap)) {
      if (fromMe !== false) continue;
      const conv = conversationsMap[convId];
      if (isLegacyConversationMeta(conv)) continue;
      count++;
    }
    return count;
  }, [conversationsMap, lastMsgFromMeMap]);

  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev;
      localStorage.setItem(SOUND_KEY, String(next));
      if (next) playNotificationChime();
      return next;
    });
  }, []);

  const toggleDesktopNotifications = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setDesktopPermission('unsupported');
      return;
    }

    if (desktopEnabled) {
      setDesktopEnabled(false);
      localStorage.setItem(DESKTOP_KEY, 'false');
      return;
    }

    let perm = Notification.permission;
    if (perm === 'default') {
      try {
        perm = await Notification.requestPermission();
      } catch {
        perm = Notification.permission;
      }
    }
    setDesktopPermission(perm);

    if (perm === 'granted') {
      setDesktopEnabled(true);
      localStorage.setItem(DESKTOP_KEY, 'true');
      try {
        new Notification('Alertas de UniChat activadas', {
          body: 'Recibirás avisos en tu PC cuando caiga un mensaje nuevo.',
          tag: 'unichat-permission-ok',
        });
      } catch {}
    } else {
      setDesktopEnabled(false);
      localStorage.setItem(DESKTOP_KEY, 'false');
    }
  }, [desktopEnabled]);

  const triggerTestNotification = useCallback(() => {
    const sample: ToastNotification = {
      id: `test-${Date.now()}`,
      conversationId: '__test__',
      senderName: 'Cliente de prueba',
      senderPhone: '+503 7000-0000',
      mode: 'bot',
      preview: '¡Hola! ¿Tienen disponible este producto con envío para hoy?',
      createdAt: new Date().toISOString(),
      isTest: true,
    };
    enqueueToast(sample);
    if (soundEnabledRef.current) {
      playNotificationChime();
    }
    if (
      desktopEnabledRef.current &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification('Cliente de prueba · UniChat', {
          body: sample.preview,
          tag: 'unichat-test',
        });
      } catch {}
    }
  }, [enqueueToast]);

  const value = useMemo<ChatNotificationContextValue>(
    () => ({
      unreadCount,
      soundEnabled,
      desktopEnabled,
      desktopPermission,
      toggleSound,
      toggleDesktopNotifications,
      triggerTestNotification,
    }),
    [
      unreadCount,
      soundEnabled,
      desktopEnabled,
      desktopPermission,
      toggleSound,
      toggleDesktopNotifications,
      triggerTestNotification,
    ]
  );

  return (
    <ChatNotificationContext.Provider value={value}>
      {children}

      {/* Tarjetas flotantes de notificación para PC / Móvil */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          aria-label="Notificaciones de mensajes entrantes"
          className="fixed top-16 right-3 left-3 sm:left-auto sm:w-[370px] lg:top-5 lg:right-5 z-[100] flex flex-col gap-2.5 pointer-events-none"
        >
          {toasts.map(toast => {
            const isHuman = toast.mode === 'human';
            return (
              <div
                key={toast.id}
                role="button"
                tabIndex={0}
                onClick={() => openChatFromToast(toast)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openChatFromToast(toast);
                  }
                }}
                onMouseEnter={() => {
                  hoveredIdsRef.current.add(toast.id);
                  if (timersRef.current[toast.id]) {
                    clearTimeout(timersRef.current[toast.id]);
                    delete timersRef.current[toast.id];
                  }
                }}
                onMouseLeave={() => {
                  hoveredIdsRef.current.delete(toast.id);
                  scheduleDismiss(toast.id, 4500);
                }}
                className="pointer-events-auto group relative overflow-hidden rounded-2xl bg-cd bd shadow-2xl hover:border-[var(--ac)] transition-all duration-150 cursor-pointer text-left"
              >
                <div
                  className="h-1 w-full"
                  style={{ background: isHuman ? 'var(--ok)' : 'var(--ac)' }}
                />

                <div className="p-3.5">
                  <div className="flex items-start gap-2.5">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-extrabold"
                      style={{
                        background: isHuman
                          ? 'color-mix(in srgb, var(--ok) 15%, transparent)'
                          : 'color-mix(in srgb, var(--ac) 15%, transparent)',
                        color: isHuman ? 'var(--ok)' : 'var(--ac)',
                      }}
                    >
                      {getInitials(toast.senderName)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[13px] font-bold text-[var(--tx)] truncate">
                            {toast.senderName}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold shrink-0"
                            style={{
                              background: 'var(--sf)',
                              color: isHuman ? 'var(--ok)' : 'var(--ac)',
                            }}
                          >
                            {isHuman ? <User size={10} /> : <Bot size={10} />}
                            {isHuman ? 'Humano' : 'Todd'}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            dismissToast(toast.id);
                          }}
                          aria-label="Descartar notificación"
                          className="p-1 -mr-1 -mt-0.5 rounded-lg tx-mu hover:text-[var(--tx)] hover:bg-sf transition-colors shrink-0"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {toast.senderPhone && (
                        <div className="text-[11px] tx-mu mono truncate">{toast.senderPhone}</div>
                      )}

                      <p className="mt-1.5 text-xs text-[var(--tx)] leading-snug line-clamp-2 break-words">
                        {toast.preview}
                      </p>

                      <div className="mt-2.5 pt-2 border-t border-[var(--bd)] flex items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1 tx-mu">
                          <MessageSquare size={11} />
                          {toast.isTest ? 'Vista previa' : formatRelativeTime(toast.createdAt)}
                        </span>
                        <span
                          className="inline-flex items-center gap-1 font-semibold group-hover:translate-x-0.5 transition-transform"
                          style={{ color: 'var(--ac)' }}
                        >
                          Abrir en UniChat
                          <ArrowRight size={12} />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ChatNotificationContext.Provider>
  );
}

export function NotificationSettingsButton({
  compact = false,
  sidebarRow = false,
  iconOnly = false,
}: {
  compact?: boolean;
  sidebarRow?: boolean;
  iconOnly?: boolean;
}) {
  const {
    soundEnabled,
    desktopEnabled,
    desktopPermission,
    toggleSound,
    toggleDesktopNotifications,
    triggerTestNotification,
  } = useChatNotifications();

  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number }>({
    top: 56,
    right: 16,
  });

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const isDesktop = window.innerWidth >= 1024;
      const panelHeight = 265;
      if (isDesktop) {
        setCoords({
          top: Math.max(12, Math.min(rect.bottom - panelHeight, window.innerHeight - panelHeight - 12)),
          left: Math.min(rect.right + 12, window.innerWidth - 296),
        });
      } else {
        setCoords({
          top: Math.min(rect.bottom + 8, window.innerHeight - panelHeight - 16),
          right: Math.max(12, window.innerWidth - rect.right),
        });
      }
    };

    updatePosition();

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    };

    window.addEventListener('resize', updatePosition);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const isMutedAll = !soundEnabled && !desktopEnabled;

  return (
    <>
      {sidebarRow ? (
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen(prev => !prev)}
          title="Configurar alertas de UniChat en PC"
          aria-label="Configurar notificaciones de UniChat"
          className={
            iconOnly
              ? 'inline-flex items-center justify-center p-2.5 rounded-xl bg-sf bd text-[var(--tx)] hover:border-[var(--ac)] transition-colors cursor-pointer shrink-0'
              : 'w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-sf bd text-xs font-medium text-[var(--tx)] hover:border-[var(--ac)] transition-colors cursor-pointer'
          }
        >
          <span className="flex items-center gap-2 min-w-0">
            {isMutedAll ? (
              <BellOff size={15} className="tx-mu shrink-0" />
            ) : (
              <Bell size={15} style={{ color: 'var(--ac)' }} className="shrink-0" />
            )}
            {!iconOnly && <span className="truncate">Alertas PC</span>}
          </span>
          {!iconOnly && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
              style={{
                background: 'var(--cd)',
                color: isMutedAll ? 'var(--mu)' : 'var(--ok)',
              }}
            >
              {isMutedAll ? 'Silencio' : desktopEnabled ? 'PC + Audio' : 'Activo'}
            </span>
          )}
        </button>
      ) : (
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen(prev => !prev)}
          title="Alertas de UniChat en PC"
          aria-label="Configurar notificaciones de UniChat"
          className={`rounded-lg bg-sf text-[var(--tx)] hover:opacity-85 transition-opacity ${
            compact ? 'p-2' : 'p-1.5'
          }`}
        >
          {isMutedAll ? (
            <BellOff size={compact ? 18 : 15} className="tx-mu" />
          ) : (
            <Bell size={compact ? 18 : 15} style={{ color: 'var(--ac)' }} />
          )}
        </button>
      )}

      {open && (
        <div
          ref={panelRef}
          style={{
            top: coords.top,
            left: coords.left,
            right: coords.right,
          }}
          className="fixed z-[95] w-[280px] rounded-2xl bg-cd bd shadow-2xl p-3.5 text-[var(--tx)]"
        >
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[var(--bd)]">
            <div>
              <div className="text-xs font-bold">Alertas de UniChat</div>
              <div className="text-[11px] tx-mu">
                Tarjetas al recibir mensajes en otros módulos
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg tx-mu hover:text-[var(--tx)] hover:bg-sf"
              aria-label="Cerrar panel de notificaciones"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-2.5 space-y-2">
            <button
              type="button"
              onClick={toggleSound}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-sf hover:opacity-90 transition-opacity text-left"
            >
              <span className="flex items-center gap-2 text-xs font-medium">
                {soundEnabled ? (
                  <Volume2 size={14} style={{ color: 'var(--ac)' }} />
                ) : (
                  <VolumeX size={14} className="tx-mu" />
                )}
                Sonido al llegar mensaje
              </span>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                style={{
                  background: soundEnabled
                    ? 'color-mix(in srgb, var(--ok) 15%, transparent)'
                    : 'var(--cd)',
                  color: soundEnabled ? 'var(--ok)' : 'var(--mu)',
                }}
              >
                {soundEnabled ? 'Activo' : 'Silencio'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void toggleDesktopNotifications()}
              disabled={desktopPermission === 'unsupported'}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-sf hover:opacity-90 transition-opacity text-left disabled:opacity-50"
            >
              <span className="flex items-center gap-2 text-xs font-medium">
                <Monitor size={14} style={{ color: desktopEnabled ? 'var(--ok)' : 'var(--mu)' }} />
                <span>
                  <span className="block">Notificación Windows/Mac</span>
                  <span className="block text-[10px] tx-mu">
                    {desktopPermission === 'denied'
                      ? 'Bloqueada en el navegador'
                      : desktopPermission === 'unsupported'
                      ? 'No soportado'
                      : 'Avisa aunque minimices'}
                  </span>
                </span>
              </span>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0"
                style={{
                  background: desktopEnabled
                    ? 'color-mix(in srgb, var(--ok) 15%, transparent)'
                    : 'var(--cd)',
                  color: desktopEnabled ? 'var(--ok)' : 'var(--mu)',
                }}
              >
                {desktopEnabled ? 'Activo' : 'Activar'}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              triggerTestNotification();
              setOpen(false);
            }}
            className="mt-3 w-full py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90"
            style={{ background: 'var(--tx)', color: 'var(--cd)' }}
          >
            <Bell size={13} />
            Probar tarjeta en PC
          </button>
        </div>
      )}
    </>
  );
}
