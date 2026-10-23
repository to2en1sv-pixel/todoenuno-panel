import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { CronRun } from '@/types/db';
import type { CronTarget } from '@/lib/endpoints';

export function useCronRuns(target?: CronTarget, limit = 50) {
  return useQuery<CronRun[]>({
    queryKey: ['cron_runs', target ?? 'all', limit],
    queryFn: async () => {
      let q = supabase.from('cron_runs').select('*')
        .order('started_at', { ascending: false }).limit(limit);
      if (target) q = q.eq('target', target);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CronRun[];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useLastRunByTarget() {
  return useQuery<Record<string, CronRun | undefined>>({
    queryKey: ['cron_last_by_target'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cron_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const map: Record<string, CronRun | undefined> = {};
      for (const r of (data ?? []) as CronRun[]) {
        if (!map[r.target]) map[r.target] = r;
      }
      return map;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
