export const TARGET_URL = {
  'post-auto': 'https://todoenuno-feed.vercel.app/api/post-auto',
  'sync-odoo': 'https://todoenuno-feed.vercel.app/api/sync-odoo-to-supabase',
  'cron':      'https://todoenuno-feed.vercel.app/api/cron',
} as const;
export type CronTarget = keyof typeof TARGET_URL;
export const SCHEDULES: Record<CronTarget, string[]> = {
  'post-auto': ['07:00', '12:00', '15:00', '20:00'],
  'sync-odoo': ['00:00', '06:00', '12:00', '18:00'],
  'cron':      ['00:00', '06:00', '12:00', '18:00'],
};
export const FRESHNESS_WINDOW_MIN = 90;
