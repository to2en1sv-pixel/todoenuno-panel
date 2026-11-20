import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isDemoMode } from './demoMode';
import { demoSupabaseClient, installDemoFetchInterceptor } from './demoSupabase';

const demoActive = isDemoMode();
if (demoActive) {
  installDemoFetchInterceptor();
}

export const supabase: SupabaseClient = demoActive
  ? (demoSupabaseClient as unknown as SupabaseClient)
  : createClient(
      import.meta.env.VITE_SUPABASE_URL || '',
      import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      { auth: { persistSession: false } }
    );

