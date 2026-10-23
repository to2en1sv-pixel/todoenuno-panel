import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin } from './_lib/supabaseAdmin';
import { SCHEDULES, FRESHNESS_WINDOW_MIN, type CronTarget } from './_lib/endpoints';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const t0 = Date.now();
  let supabase: { ok: boolean; latency_ms: number; error?: string } = { ok: false, latency_ms: 0 };
  try {
    const sb = admin();
    const { error } = await sb.from('productos').select('template_id').limit(1);
    supabase = { ok: !error, latency_ms: Date.now() - t0, error: error?.message };
  } catch (e: unknown) {
    supabase = { ok: false, latency_ms: Date.now() - t0, error: (e as Error).message };
  }

  const crons: Array<{
    target: string;
    last_success: string | null;
    minutes_ago: number | null;
    fresh: boolean;
    expected_next: string | null;
  }> = [];

  try {
    const sb = admin();
    const { data } = await sb
      .from('cron_runs')
      .select('target,status,started_at')
      .order('started_at', { ascending: false })
      .limit(200);

    const targets = Object.keys(SCHEDULES) as CronTarget[];
    for (const target of targets) {
      const success = (data ?? []).find((r) => r.target === target && r.status === 'success');
      const minutes_ago = success
        ? Math.round((Date.now() - new Date(success.started_at).getTime()) / 60000)
        : null;
      const fresh = minutes_ago !== null && minutes_ago <= FRESHNESS_WINDOW_MIN;
      crons.push({
        target,
        last_success: success?.started_at ?? null,
        minutes_ago,
        fresh,
        expected_next: nextExpected(SCHEDULES[target]),
      });
    }
  } catch {
    /* swallow */
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ supabase, crons, ts: new Date().toISOString() });
}

function nextExpected(times: string[]): string {
  const now = new Date();
  const today = times
    .map((t) => {
      const [h, m] = t.split(':').map(Number);
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      return d;
    })
    .filter((d) => d.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  const next = today[0] ?? (() => {
    const [h, m] = times[0].split(':').map(Number);
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0);
    return d;
  })();
  return next.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
}
