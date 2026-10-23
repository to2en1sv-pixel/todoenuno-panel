import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export type HealthPayload = {
  supabase: { ok: boolean; latency_ms: number; error?: string };
  crons: Array<{
    target: string;
    last_success: string | null;
    minutes_ago: number | null;
    fresh: boolean;
    expected_next: string | null;
  }>;
  ts: string;
};

export function useHealth() {
  return useQuery<HealthPayload>({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthPayload>('/api/health'),
    refetchInterval: 60_000,
    retry: 1,
  });
}
