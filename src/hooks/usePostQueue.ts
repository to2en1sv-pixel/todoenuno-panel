import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
export function usePostQueue() { 
  return useQuery({ 
    queryKey: ['post_queue'], 
    queryFn: async () => (await supabase.from('post_queue').select('*').order('created_at', { ascending: false }).limit(100)).data || [] 
  }); 
}
