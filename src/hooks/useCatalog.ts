import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Producto, Variante, InventoryItem } from '@/types/db';

export function useProductos() {
  return useQuery<Producto[]>({
    queryKey: ['productos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('productos')
        .select('*')
        .order('template_id', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useVariantes(templateId?: number | null) {
  return useQuery<Variante[]>({
    queryKey: ['variantes', templateId ?? 'all'],
    queryFn: async () => {
      let q = supabase.from('productos_variantes').select('*');
      if (templateId) q = q.eq('template_id', templateId);
      const { data, error } = await q.order('updated_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useInventory() {
  return useQuery<InventoryItem[]>({
    queryKey: ['inventory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_cache')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });
}
