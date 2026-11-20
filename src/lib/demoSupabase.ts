import { createInitialDemoDataset, type DemoTables } from './demoDataset';
import { isDemoMode, notifyDemoReset } from './demoMode';

const TABLE_ALIASES: Record<string, string> = {
  finance_cash_accounts: 'cash_accounts',
  finance_money_transactions: 'money_transactions',
  finance_budgets: 'budgets',
  events: 'os_events',
  event_types: 'os_event_types',
  event_consumers: 'os_event_consumers',
  daily_memory: 'os_daily_memory',
};

function resolveTableName(name: string): string {
  return TABLE_ALIASES[name] || name;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

let store: DemoTables | null = null;
let autoSeq = 95000;

function ensureStore(): DemoTables {
  if (!store) {
    store = createInitialDemoDataset();
  }
  return store;
}

export function resetDemoStore(): void {
  store = createInitialDemoDataset();
  notifyDemoReset();
}

export function getDemoTableRows<T = any>(tableName: string): T[] {
  const s = ensureStore();
  const key = resolveTableName(tableName);
  if (!s[key]) s[key] = [];
  return deepClone(s[key]) as T[];
}

type FilterFn = (row: Record<string, any>) => boolean;

function matchLike(value: any, pattern: string, caseInsensitive: boolean): boolean {
  if (value === null || value === undefined) return false;
  const src = caseInsensitive ? String(value).toLowerCase() : String(value);
  const pat = caseInsensitive ? String(pattern).toLowerCase() : String(pattern);
  const escaped = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 's').test(src);
}

function compareValues(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  const numA = typeof a === 'number' ? a : Number.NaN;
  const numB = typeof b === 'number' ? b : Number.NaN;
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
  return String(a).localeCompare(String(b));
}

function parseOrExpression(expr: string): FilterFn {
  const clauses = expr
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  const fns: FilterFn[] = clauses.map((clause) => {
    const parts = clause.split('.');
    if (parts.length < 3) return () => true;
    const col = parts[0];
    const op = parts[1];
    const val = parts.slice(2).join('.');
    return (row) => {
      const rv = row[col];
      switch (op) {
        case 'eq':
          return String(rv ?? '') === val;
        case 'neq':
          return String(rv ?? '') !== val;
        case 'ilike':
          return matchLike(rv, val, true);
        case 'like':
          return matchLike(rv, val, false);
        case 'gt':
          return compareValues(rv, val) > 0;
        case 'gte':
          return compareValues(rv, val) >= 0;
        case 'lt':
          return compareValues(rv, val) < 0;
        case 'lte':
          return compareValues(rv, val) <= 0;
        case 'is':
          if (val === 'null') return rv === null || rv === undefined;
          if (val === 'true') return rv === true;
          if (val === 'false') return rv === false;
          return false;
        default:
          return true;
      }
    };
  });

  return (row) => fns.some((fn) => fn(row));
}

class DemoQueryBuilder {
  private tableKey: string;
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: any = null;
  private upsertOnConflict: string | null = null;
  private selectRequested = false;
  private headOnly = false;
  private countMode: string | null = null;
  private filters: FilterFn[] = [];
  private orders: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }> = [];
  private limitVal: number | null = null;
  private rangeVal: [number, number] | null = null;
  private expectSingle: 'none' | 'single' | 'maybeSingle' = 'none';

  constructor(tableName: string) {
    this.tableKey = resolveTableName(tableName);
  }

  select(_columns = '*', options?: { count?: string; head?: boolean }) {
    this.selectRequested = true;
    if (options?.count) this.countMode = options.count;
    if (options?.head) this.headOnly = true;
    return this;
  }

  insert(rows: any) {
    this.mode = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(patch: Record<string, any>) {
    this.mode = 'update';
    this.payload = patch;
    return this;
  }

  upsert(rows: any, options?: { onConflict?: string }) {
    this.mode = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.upsertOnConflict = options?.onConflict || null;
    return this;
  }

  delete() {
    this.mode = 'delete';
    return this;
  }

  eq(col: string, val: any) {
    this.filters.push((r) => r[col] === val || String(r[col] ?? '') === String(val ?? ''));
    return this;
  }

  neq(col: string, val: any) {
    this.filters.push((r) => r[col] !== val && String(r[col] ?? '') !== String(val ?? ''));
    return this;
  }

  gt(col: string, val: any) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && compareValues(r[col], val) > 0);
    return this;
  }

  gte(col: string, val: any) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && compareValues(r[col], val) >= 0);
    return this;
  }

  lt(col: string, val: any) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && compareValues(r[col], val) < 0);
    return this;
  }

  lte(col: string, val: any) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && compareValues(r[col], val) <= 0);
    return this;
  }

  in(col: string, values: any[]) {
    const set = new Set((values || []).map((v) => String(v)));
    this.filters.push((r) => set.has(String(r[col])));
    return this;
  }

  ilike(col: string, pattern: string) {
    this.filters.push((r) => matchLike(r[col], pattern, true));
    return this;
  }

  like(col: string, pattern: string) {
    this.filters.push((r) => matchLike(r[col], pattern, false));
    return this;
  }

  is(col: string, val: any) {
    if (val === null) {
      this.filters.push((r) => r[col] === null || r[col] === undefined);
    } else {
      this.filters.push((r) => r[col] === val);
    }
    return this;
  }

  not(col: string, op: string, val: any) {
    this.filters.push((r) => {
      const rv = r[col];
      if (op === 'is' && val === null) return rv !== null && rv !== undefined;
      if (op === 'eq') return rv !== val;
      if (op === 'in') {
        const cleaned = String(val || '').replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '').trim());
        return !cleaned.includes(String(rv));
      }
      if (op === 'ilike') return !matchLike(rv, String(val), true);
      return true;
    });
    return this;
  }

  or(expression: string) {
    this.filters.push(parseOrExpression(expression));
    return this;
  }

  contains(col: string, val: any) {
    this.filters.push((r) => {
      const rv = r[col];
      if (Array.isArray(rv) && Array.isArray(val)) {
        return val.every((v) => rv.includes(v));
      }
      return false;
    });
    return this;
  }

  match(query: Record<string, any>) {
    Object.entries(query || {}).forEach(([k, v]) => this.eq(k, v));
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({
      column,
      ascending: options?.ascending !== false,
      nullsFirst: options?.nullsFirst,
    });
    return this;
  }

  limit(n: number) {
    this.limitVal = n;
    return this;
  }

  range(from: number, to: number) {
    this.rangeVal = [from, to];
    return this;
  }

  single() {
    this.expectSingle = 'single';
    return this;
  }

  maybeSingle() {
    this.expectSingle = 'maybeSingle';
    return this;
  }

  private execute() {
    const s = ensureStore();
    if (!s[this.tableKey]) s[this.tableKey] = [];
    const table = s[this.tableKey];

    const matchesAll = (row: Record<string, any>) => this.filters.every((fn) => fn(row));

    if (this.mode === 'insert') {
      const inserted = (this.payload || []).map((item: Record<string, any>) => {
        const copy = deepClone(item);
        if (copy.id === undefined && this.tableKey !== 'inventory_stock' && this.tableKey !== 'inventory_cache' && this.tableKey !== 'os_daily_memory') {
          copy.id = this.tableKey === 'money_transactions' || this.tableKey === 'inventory_kardex' || this.tableKey === 'os_events'
            ? ++autoSeq
            : `demo-${++autoSeq}`;
        }
        if (!copy.created_at) {
          copy.created_at = new Date().toISOString();
        }
        table.unshift(copy);
        return deepClone(copy);
      });
      return this.formatResult(inserted, inserted.length);
    }

    if (this.mode === 'upsert') {
      const conflictKey = this.upsertOnConflict || (this.tableKey === 'inventory_stock' || this.tableKey === 'inventory_cache' ? 'sku' : this.tableKey === 'os_daily_memory' ? 'day' : 'id');
      const affected: any[] = [];
      for (const item of this.payload || []) {
        const copy = deepClone(item);
        const existingIdx = copy[conflictKey] !== undefined
          ? table.findIndex((r) => String(r[conflictKey]) === String(copy[conflictKey]))
          : -1;
        if (existingIdx >= 0) {
          table[existingIdx] = { ...table[existingIdx], ...copy, updated_at: new Date().toISOString() };
          affected.push(deepClone(table[existingIdx]));
        } else {
          if (copy.id === undefined && conflictKey === 'id') copy.id = `demo-${++autoSeq}`;
          if (!copy.created_at) copy.created_at = new Date().toISOString();
          table.unshift(copy);
          affected.push(deepClone(copy));
        }
      }
      return this.formatResult(affected, affected.length);
    }

    if (this.mode === 'update') {
      const updated: any[] = [];
      for (let i = 0; i < table.length; i++) {
        if (matchesAll(table[i])) {
          table[i] = { ...table[i], ...deepClone(this.payload), updated_at: new Date().toISOString() };
          updated.push(deepClone(table[i]));
        }
      }
      return this.formatResult(updated, updated.length);
    }

    if (this.mode === 'delete') {
      const removed: any[] = [];
      for (let i = table.length - 1; i >= 0; i--) {
        if (matchesAll(table[i])) {
          removed.push(deepClone(table[i]));
          table.splice(i, 1);
        }
      }
      return this.formatResult(removed, removed.length);
    }

    // SELECT mode
    let rows = table.filter(matchesAll).map((r) => deepClone(r));
    const totalCount = rows.length;

    if (this.orders.length > 0) {
      rows.sort((a, b) => {
        for (const ord of this.orders) {
          const cmp = compareValues(a[ord.column], b[ord.column]);
          if (cmp !== 0) return ord.ascending ? cmp : -cmp;
        }
        return 0;
      });
    }

    if (this.rangeVal) {
      rows = rows.slice(this.rangeVal[0], this.rangeVal[1] + 1);
    } else if (this.limitVal !== null) {
      rows = rows.slice(0, this.limitVal);
    }

    if (this.headOnly) {
      return { data: null, error: null, count: this.countMode ? totalCount : null };
    }

    return this.formatResult(rows, totalCount);
  }

  private formatResult(rows: any[], totalCount: number) {
    if (this.expectSingle === 'single') {
      if (rows.length === 0) {
        return { data: null, error: { message: 'Row not found', code: 'PGRST116' }, count: 0 };
      }
      return { data: rows[0], error: null, count: 1 };
    }
    if (this.expectSingle === 'maybeSingle') {
      return { data: rows[0] ?? null, error: null, count: rows.length };
    }
    return {
      data: this.mode === 'select' || this.selectRequested ? rows : rows,
      error: null,
      count: this.countMode ? totalCount : null,
    };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

function createNoopChannel() {
  const ch: any = {
    on: () => ch,
    subscribe: () => ch,
    unsubscribe: () => Promise.resolve('ok'),
  };
  return ch;
}

export const demoSupabaseClient: any = {
  from: (table: string) => new DemoQueryBuilder(table),
  schema: (_schemaName: string) => ({
    from: (table: string) => new DemoQueryBuilder(table),
    rpc: (fn: string, args?: any) => demoSupabaseClient.rpc(fn, args),
  }),
  rpc: async (fn: string, args?: Record<string, any>) => {
    const s = ensureStore();
    if (fn === 'emit_os_event') {
      const evt = {
        id: ++autoSeq,
        type: args?.p_type || 'system.demo',
        occurred_at: args?.p_occurred_at || new Date().toISOString(),
        source_table: args?.p_source_table || 'demo',
        source_id: String(args?.p_source_id || autoSeq),
        idempotency_key: args?.p_idempotency_key || `demo-${autoSeq}`,
        payload: args?.p_payload || {},
        created_at: new Date().toISOString(),
      };
      s.os_events.unshift(evt);
      return { data: evt.id, error: null };
    }
    if (fn === 'rebuild_os_memory') {
      return { data: s.os_daily_memory.length, error: null };
    }
    return { data: null, error: null };
  },
  channel: () => createNoopChannel(),
  removeChannel: () => Promise.resolve('ok'),
  storage: {
    getBucket: async (bucket: string) => ({ data: { id: bucket, name: bucket, public: true }, error: null }),
    from: () => ({
      upload: async (path: string) => ({ data: { path }, error: null }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: path } }),
      list: async () => ({ data: [], error: null }),
      remove: async () => ({ data: [], error: null }),
    }),
  },
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
};

let fetchPatched = false;

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function installDemoFetchInterceptor(): void {
  if (typeof window === 'undefined' || fetchPatched || !isDemoMode()) return;
  fetchPatched = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isDemoMode()) return originalFetch(input, init);

    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!urlStr.startsWith('/api/')) {
      return originalFetch(input, init);
    }

    // Parse query & JSON body cleanly
    const parsedUrl = new URL(urlStr, window.location.origin);
    const path = parsedUrl.pathname;
    let body: any = {};
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = {};
      }
    }

    // Intercept all live backend endpoints safely so ZERO external webhooks or real data fire
    if (path === '/api/send-message') {
      const s = ensureStore();
      if (body?.conversation_id && body?.message) {
        s.bb_messages.push({
          id: `m-demo-${++autoSeq}`,
          conversation_id: body.conversation_id,
          body: String(body.message),
          from_me: true,
          created_at: new Date().toISOString(),
        });
        const conv = s.bb_conversations.find((c) => c.id === body.conversation_id);
        if (conv) {
          conv.last_message = String(body.message);
          conv.updated_at = new Date().toISOString();
        }
      }
      return jsonResponse({ ok: true, demo: true, message: 'Mensaje simulado en entorno Demo (sin envío real).' });
    }

    if (path === '/api/toggle-bot') {
      const s = ensureStore();
      const conv = s.bb_conversations.find((c) => c.id === body?.conversation_id || c.contact_phone === body?.phone);
      if (conv) {
        conv.status = body?.status || (conv.status === 'bot' ? 'humano' : 'bot');
      }
      return jsonResponse({ ok: true, demo: true, status: conv?.status || 'bot' });
    }

    if (path === '/api/delete-conversation') {
      const s = ensureStore();
      if (body?.conversation_id) {
        s.bb_conversations = s.bb_conversations.filter((c) => c.id !== body.conversation_id);
        s.bb_messages = s.bb_messages.filter((m) => m.conversation_id !== body.conversation_id);
      }
      return jsonResponse({ ok: true, demo: true });
    }

    if (path === '/api/morning-brief') {
      const mode = parsedUrl.searchParams.get('telegram_mode');
      if (mode === 'status') {
        return jsonResponse({
          ok: true,
          demo: true,
          configured: true,
          botUsername: 'NexoCopilotDemoBot',
          webhookUrl: 'https://demo.nexocodos.app/api/morning-brief',
          webhookActive: true,
          pendingUpdateCount: 0,
        });
      }
      return jsonResponse({
        ok: true,
        demo: true,
        message: 'Simulación ejecutada en Modo Demo. Abre el Copiloto Telegram IA en la barra superior para probarlo interactivamente.',
      });
    }

    if (path === '/api/meta-ads-sync') {
      return jsonResponse({
        ok: true,
        demo: true,
        configured: true,
        accountName: 'Nexo Store LATAM — Ad Account Demo',
        syncedRows: 12,
        campaigns: [
          {
            campaign_id: 'cmp-demo-1',
            campaign_name: 'SV · Conversión WhatsApp · Audífonos + Lámpara (UGC)',
            ad_code: 'AD-UGC-01',
            status: 'ACTIVE',
            spend: 172.5,
            impressions: 68420,
            clicks: 2490,
            messaging_conversations: 148,
            ctr: 3.64,
            cpc: 0.07,
            cost_per_conversation: 1.17,
          },
          {
            campaign_id: 'cmp-demo-2',
            campaign_name: 'SV · Video Demo 15s · Licuadora + Cámara WiFi',
            ad_code: 'AD-DEMO-02',
            status: 'ACTIVE',
            spend: 127.5,
            impressions: 51300,
            clicks: 1710,
            messaging_conversations: 102,
            ctr: 3.33,
            cpc: 0.07,
            cost_per_conversation: 1.25,
          },
          {
            campaign_id: 'cmp-demo-3',
            campaign_name: 'SV · Retargeting Catálogo Dinámico 7d',
            ad_code: 'AD-PROMO-03',
            status: 'ACTIVE',
            spend: 67.5,
            impressions: 24800,
            clicks: 940,
            messaging_conversations: 61,
            ctr: 3.79,
            cpc: 0.07,
            cost_per_conversation: 1.11,
          },
        ],
      });
    }

    if (path === '/api/cron-status') {
      const nowSec = Math.floor(Date.now() / 1000);
      return jsonResponse({
        ok: true,
        demo: true,
        jobs: [
          { id: 'cron-1', title: 'Brief Matutino + Radar IA (8:00 AM)', url: 'https://demo.nexocodos.app/api/morning-brief?type=morning', lastStatus: 1, lastStatusText: 'OK (200)', lastExecution: nowSec - 7200, nextExecution: nowSec + 79200 },
          { id: 'cron-2', title: 'Cierre Vespertino + Liquidaciones (5:00 PM)', url: 'https://demo.nexocodos.app/api/morning-brief?type=evening', lastStatus: 1, lastStatusText: 'OK (200)', lastExecution: nowSec - 64800, nextExecution: nowSec + 21600 },
          { id: 'cron-3', title: 'Sincronización Meta Ads Insights (cada 6h)', url: 'https://demo.nexocodos.app/api/meta-ads-sync', lastStatus: 1, lastStatusText: 'OK (200)', lastExecution: nowSec - 3600, nextExecution: nowSec + 18000 },
        ],
      });
    }

    if (path === '/api/todd-bridge') {
      return jsonResponse({
        ok: true,
        demo: true,
        connected: true,
        workflowName: 'Todd · Agente Ventas COD (Demo)',
        active: true,
        systemPrompt:
          'Eres Todd, asesor comercial de Nexo Store LATAM. Respondes con claridad y brevedad, recomiendas productos con stock real, ofreces upsells de alto margen y registras pedidos COD validando dirección y departamento.',
      });
    }

    if (path === '/api/content-distribute') {
      return jsonResponse({
        ok: true,
        demo: true,
        pages: [
          { page_id: 'pg-nexo-1', page_name: 'Nexo Home & Tech LATAM', tokenValid: true, canPublish: true, canInbox: true },
          { page_id: 'pg-nexo-2', page_name: 'Nexo Ofertas Flash', tokenValid: true, canPublish: true, canInbox: true },
        ],
      });
    }

    if (path === '/api/generate-copy') {
      const product = body?.productName || body?.nombre || 'Producto Destacado';
      return jsonResponse({
        ok: true,
        demo: true,
        copy: `Descubre ${product} con entrega a domicilio y pago al recibir.\n\n• Envío rápido en área metropolitana y todo el país\n• Garantía directa de 30 días\n• Stock disponible para despacho hoy\n\nEscríbenos por WhatsApp para reservar el tuyo.`,
      });
    }

    if (path === '/api/send-meta-message') {
      return jsonResponse({ ok: true, demo: true, message: 'Respuesta simulada en Modo Demo.' });
    }

    if (path === '/api/evolution-media') {
      return jsonResponse({ ok: false, demo: true, error: 'Descarga de multimedia externa desactivada en Modo Demo.' });
    }

    return jsonResponse({ ok: true, demo: true });
  };
}
