import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin } from './_lib/supabaseAdmin';
import { TARGET_URL, type CronTarget } from './_lib/endpoints';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const token = req.headers['x-panel-token'];
  if (!token || token !== process.env.PANEL_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const target = (req.body?.target ?? '') as CronTarget;
  const url = TARGET_URL[target];
  if (!url) return res.status(400).json({ error: 'unknown target' });

  const secret = process.env.CRONJOB_SECRET!;
  const fullUrl = `${url}?secret=${encodeURIComponent(secret)}`;
  const sb = admin();

  const started = new Date();
  const runId = crypto.randomUUID();
  await sb.from('cron_runs').insert({
    id: runId,
    target,
    source: 'manual',
    status: 'running',
    started_at: started.toISOString(),
  });

  const t0 = Date.now();
  try {
    const r = await fetch(fullUrl, { method: 'GET' });
    const duration = Date.now() - t0;
    const text = await r.text().catch(() => '');
    await sb.from('cron_runs').update({
      status: r.ok ? 'success' : 'error',
      finished_at: new Date().toISOString(),
      duration_ms: duration,
      http_status: r.status,
      message: text.slice(0, 500),
    }).eq('id', runId);

    return res.status(200).json({
      ok: r.ok,
      http_status: r.status,
      duration_ms: duration,
      message: text.slice(0, 200),
    });
  } catch (e: unknown) {
    await sb.from('cron_runs').update({
      status: 'error',
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      message: (e as Error).message,
    }).eq('id', runId);
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
