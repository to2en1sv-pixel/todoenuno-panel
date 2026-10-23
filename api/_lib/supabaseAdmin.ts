import { createClient } from '@supabase/supabase-js';
export function admin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel Env');
  return createClient(url, key, { auth: { persistSession: false } });
}
