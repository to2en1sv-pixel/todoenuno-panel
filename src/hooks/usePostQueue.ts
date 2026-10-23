import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { PostQueueItem } from '@/types/db';

export function usePostQueue() {
  return useQuery<PostQueueItem[]>({
    queryKey: ['post_queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('post_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}
