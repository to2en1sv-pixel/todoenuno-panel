import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Inbox, MessageCircle, RefreshCw, Search, Send, Loader2, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';

// ---------- Tipos ----------
interface LeadRow {
  id: string;
  page_id: string;
  fb_post_id: string;
  fb_comment_id: string;
  fb_user_id: string | null;
  fb_user_name: string | null;
  keyword: string | null;
  message_text: string | null;
  created_at: string;
}

interface MessageRow {
  id: string;
  page_id: string;
  sender_id: string;
  sender_name: string | null;
  message_text: string;
  is_from_page: boolean | null;
  created_at: string;
}

interface PageRow {
  page_id: string;
  page_name: string | null;
}

type ItemKind = 'comment' | 'dm';

interface InboxItem {
  id: string;
  kind: ItemKind;
  contactId: string;
  contactName: string;
  pageId: string;
  text: string;
  createdAt: string;
  fromPage: boolean;
  keyword?: string | null;
}

interface Conversation {
  key: string;
  contactId: string;
  contactName: string;
  pageId: string;
  lastText: string;
  lastAt: string;
  items: InboxItem[];
}

// ---------- Helpers ----------
function initials(name: string) {
  return name?.trim().slice(0, 2).toUpperCase() || '??';
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

// ---------- Componente ----------
export function SocialInbox() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [pageNames, setPageNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ---------- Carga de datos ----------
  const load = useCallback(async () => {
    setError(null);
    const [leadsRes, msgsRes, pagesRes] = await Promise.all([
      supabase.from('fb_leads').select('*').order('created_at', { ascending: true }),
      supabase.from('fb_messages').select('*').order('created_at', { ascending: true }),
      supabase.from('fb_pages').select('page_id, page_name'),
    ]);

    const firstError = leadsRes.error || msgsRes.error || pagesRes.error;
    if (firstError) setError(firstError.message);

    setLeads((leadsRes.data as LeadRow[]) ?? []);
    setMessages((msgsRes.data as MessageRow[]) ?? []);

    const map: Record<string, string> = {};
    for (const p of (pagesRes.data as PageRow[]) ?? []) {
      map[p.page_id] = p.page_name || p.page_id;
    }
    setPageNames(map);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ---------- Realtime ----------
  useEffect(() => {
    const channel = supabase
      .channel('social-inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fb_leads' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fb_messages' }, () => load())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [load]);

  // ---------- Construcción de conversaciones unificadas ----------
  const conversations = useMemo<Conversation[]>(() => {
    const items: InboxItem[] = [];

    for (const l of leads) {
      if (!l.fb_user_id) continue;
      items.push({
        id: `lead-${l.id}`,
        kind: 'comment',
        contactId: l.fb_user_id,
        contactName: l.fb_user_name || 'Contacto',
        pageId: l.page_id,
        text: l.message_text || l.keyword || 'Comentario',
        createdAt: l.created_at,
        fromPage: false,
        keyword: l.keyword,
      });
    }

    for (const m of messages) {
      items.push({
        id: `msg-${m.id}`,
        kind: 'dm',
        contactId: m.sender_id,
        contactName: m.sender_name || 'Contacto',
        pageId: m.page_id,
        text: m.message_text,
        createdAt: m.created_at,
        fromPage: !!m.is_from_page,
      });
    }

    const map = new Map<string, Conversation>();
    for (const it of items) {
      const key = `${it.pageId}:${it.contactId}`;
      let c = map.get(key);
      if (!c) {
        c = {
          key,
          contactId: it.contactId,
          contactName: it.contactName,
          pageId: it.pageId,
          lastText: it.text,
          lastAt: it.createdAt,
          items: [],
        };
        map.set(key, c);
      }
      c.items.push(it);
      if (it.contactName && it.contactName !== 'Contacto') c.contactName = it.contactName;
      if (new Date(it.createdAt) >= new Date(c.lastAt)) {
        c.lastAt = it.createdAt;
        c.lastText = it.text;
      }
    }

    const arr = Array.from(map.values());
    for (const c of arr) {
      c.items.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    }
    arr.sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt));
    return arr;
  }, [leads, messages]);

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(
      (c) =>
        c.contactName.toLowerCase().includes(q) ||
        c.lastText.toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const selected = useMemo(
    () => conversations.find((c) => c.key === selectedKey) ?? null,
    [conversations, selectedKey]
  );

  // Autoseleccionar la primera conversación en Escritorio, pero NO en móvil
  useEffect(() => {
    if (!selectedKey && conversations.length > 0 && window.innerWidth >= 768) {
      setSelectedKey(conversations[0].key);
    }
  }, [conversations, selectedKey]);

  // Scroll al último mensaje
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.items.length, selectedKey]);

  // ---------- Enviar respuesta por DM ----------
  async function handleSend() {
    if (!selected || !draft.trim() || sending) return;
    const text = draft.trim();
    setSending(true);
    setError(null);

    try {
      const res = await fetch('/api/send-meta-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageId: selected.pageId,
          recipientId: selected.contactId,
          text,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'No se pudo enviar el mensaje');

      setDraft('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Error enviando mensaje');
    } finally {
      setSending(false);
    }
  }

  // ---------- Render ----------
  return (
    <div className="flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-[var(--bg)]">
      
      {/* ================= Columna izquierda (Lista de Chats) ================= */}
      {/* En móvil: Ocupa todo el ancho. Se oculta si hay un chat seleccionado. */}
      {/* En escritorio: Ancho fijo, siempre visible. */}
      <aside className={`w-full md:max-w-sm flex-col border-r border-[var(--bd)] bg-[var(--cd)] ${selectedKey ? 'hidden md:flex' : 'flex'}`}>
        <div className="flex items-center justify-between border-b border-[var(--bd)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-[var(--ac)]" />
            <h1 className="text-base font-semibold text-[var(--tx)]">Bandeja Social</h1>
            <span className="rounded-full bg-[var(--ac)]/10 px-2 py-0.5 text-xs font-medium text-[var(--ac)]">
              {conversations.length}
            </span>
          </div>
          <button
            onClick={load}
            title="Actualizar"
            className="rounded-lg p-2 text-[var(--tx)]/60 hover:bg-[var(--bg)] hover:text-[var(--tx)]"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="border-b border-[var(--bd)] p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--tx)]/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversación..."
              className="w-full rounded-lg border border-[var(--bd)] bg-[var(--bg)] py-2 pl-9 pr-3 text-sm text-[var(--tx)] outline-none focus:border-[var(--ac)] focus:ring-2 focus:ring-[var(--ac)]/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && conversations.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-[var(--tx)]/40">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--tx)]/60">
              Sin conversaciones todavía.
            </div>
          ) : (
            filtered.map((c) => {
              const isActive = c.key === selectedKey;
              const hasComment = c.items.some((i) => i.kind === 'comment');
              return (
                <button
                  key={c.key}
                  onClick={() => setSelectedKey(c.key)}
                  className={`flex w-full items-start gap-3 border-b border-[var(--bd)]/50 px-4 py-3 text-left transition ${
                    isActive ? 'bg-[var(--ac)]/5' : 'hover:bg-[var(--bg)]'
                  }`}
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--ac)] text-sm font-semibold text-[var(--cd)]">
                    {initials(c.contactName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-[var(--tx)]">
                        {c.contactName}
                      </span>
                      <span className="flex-shrink-0 text-[11px] text-[var(--tx)]/40">
                        {formatTime(c.lastAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-[var(--tx)]/60">{c.lastText}</p>
                      <span
                        className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          hasComment
                            ? 'bg-amber-500/10 text-amber-500'
                            : 'bg-sky-500/10 text-sky-500'
                        }`}
                      >
                        {hasComment ? 'Comentario' : 'DM'}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ================= Columna derecha (Ventana de Chat) ================= */}
      {/* En móvil: Se oculta si no hay chat seleccionado. Ocupa todo si hay uno. */}
      {/* En escritorio: Siempre visible ocupando el espacio restante. */}
      <section className={`flex-1 flex-col bg-[var(--bg)] ${!selectedKey ? 'hidden md:flex' : 'flex'}`}>
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center text-[var(--tx)]/40">
            <MessageCircle className="mb-3 h-12 w-12" />
            <p className="text-sm">Selecciona una conversación para empezar</p>
          </div>
        ) : (
          <>
            {/* Header del Chat */}
            <header className="flex items-center justify-between border-b border-[var(--bd)] bg-[var(--cd)] px-3 md:px-5 py-3">
              <div className="flex items-center gap-2 md:gap-3">
                {/* BOTÓN DE VOLVER (Solo visible en móvil) */}
                <button
                  onClick={() => setSelectedKey(null)}
                  className="md:hidden p-1.5 -ml-1 rounded-lg text-[var(--tx)]/70 hover:bg-[var(--bg)]"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>

                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ac)] text-sm font-semibold text-[var(--cd)]">
                  {initials(selected.contactName)}
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[var(--tx)]">
                    {selected.contactName}
                  </h2>
                  <p className="text-xs text-[var(--tx)]/60">
                    {pageNames[selected.pageId] || selected.pageId}
                  </p>
                </div>
              </div>
              <span className="hidden md:inline-block rounded-full bg-[var(--bg)] px-2.5 py-1 text-xs font-medium text-[var(--tx)]/70">
                {selected.items.length} mensaje{selected.items.length !== 1 ? 's' : ''}
              </span>
            </header>

            {/* Historial de Mensajes */}
            <div className="flex-1 space-y-3 overflow-y-auto p-4 md:p-5 bg-[var(--bg)]">
              {selected.items.map((it) => {
                if (it.kind === 'comment') {
                  return (
                    <div key={it.id} className="flex justify-start">
                      <div className="max-w-[85%] md:max-w-[75%] rounded-2xl rounded-tl-sm border border-amber-500/30 bg-amber-500/10 px-4 py-2 shadow-sm">
                        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                          <MessageCircle className="h-3 w-3" /> Comentario público
                        </div>
                        <p className="text-sm text-[var(--tx)]">{it.text}</p>
                        {it.keyword && (
                          <span className="mt-1 inline-block rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                            keyword: {it.keyword}
                          </span>
                        )}
                        <div className="mt-1 text-[10px] text-[var(--tx)]/40">
                          {formatTime(it.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={it.id}
                    className={`flex ${it.fromPage ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-2 shadow-sm ${
                        it.fromPage
                          ? 'rounded-tr-sm bg-[var(--ac)] text-[var(--cd)]'
                          : 'rounded-tl-sm bg-[var(--cd)] text-[var(--tx)] border border-[var(--bd)]'
                      }`}
                    >
                      <p className="whitespace-pre-wrap text-sm">{it.text}</p>
                      <div
                        className={`mt-1 text-[10px] ${
                          it.fromPage ? 'text-[var(--cd)]/70' : 'text-[var(--tx)]/40'
                        }`}
                      >
                        {formatTime(it.createdAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input de Respuesta */}
            <footer className="border-t border-[var(--bd)] bg-[var(--cd)] p-3">
              {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-end gap-2"
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={1}
                  placeholder="Escribe una respuesta por DM..."
                  className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-[var(--bd)] bg-[var(--bg)] px-4 py-2.5 text-sm text-[var(--tx)] outline-none focus:border-[var(--ac)] focus:ring-2 focus:ring-[var(--ac)]/20"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-xl bg-[var(--ac)] text-[var(--cd)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </button>
              </form>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
