import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { FbPostActivo } from '@/types/db';

export function useFbPostsActivos() {
  return useQuery<FbPostActivo[]>({
    queryKey: ['fb_posts_activos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fb_posts_activos')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}
