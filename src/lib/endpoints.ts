// Schedules esperados (formato HH:mm, zona America/El_Salvador)
export const SCHEDULES = {
  'post-auto': ['07:00', '12:00', '15:00', '20:00'],
  'sync-odoo': ['00:00', '06:00', '12:00', '18:00'],
  'cron':      ['00:00', '06:00', '12:00', '18:00'],
} as const;

export type CronTarget = keyof typeof SCHEDULES;

export const TARGET_LABEL: Record<CronTarget, string> = {
  'post-auto': 'Auto-post Facebook',
  'sync-odoo': 'Sync Odoo → Supabase',
  'cron':      'Feed catálogo Meta',
};

export const TARGET_URL: Record<CronTarget, string> = {
  'post-auto': 'https://todoenuno-feed.vercel.app/api/post-auto',
  'sync-odoo': 'https://todoenuno-feed.vercel.app/api/sync-odoo-to-supabase',
  'cron':      'https://todoenuno-feed.vercel.app/api/cron',
};

// Ventana de tolerancia (min) para considerar una ejecución como "fresca"
export const FRESHNESS_WINDOW_MIN = 90;
