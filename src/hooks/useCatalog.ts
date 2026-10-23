import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
export function useProductos() { return useQuery({ queryKey: ['productos'], queryFn: async () => (await supabase.from('productos').select('*')).data || [] }); }
export function useVariantes() { return useQuery({ queryKey: ['variantes'], queryFn: async () => (await supabase.from('productos_variantes').select('*')).data || [] }); }
export function useInventory() { return useQuery({ queryKey: ['inventory'], queryFn: async () => (await supabase.from('inventory_cache').select('*')).data || [] }); }
