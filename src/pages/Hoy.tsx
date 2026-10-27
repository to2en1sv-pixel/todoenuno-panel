import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { usePostQueue } from '@/hooks/usePostQueue';
import { useInventory, useProductos, useVariantes } from '@/hooks/useCatalog';
import { Skeleton } from '@/components/ui/Skeleton';
import { fmtAgo } from '@/lib/format';
import { Package, AlertTriangle, CircleDot, DollarSign, ServerCrash, CheckCircle2, Boxes, Send, StickyNote, Trash2, Plus } from 'lucide-react';

export function HoyPage() {
  const queue = usePostQueue();
  const inv = useInventory();
  const productos = useProductos();
  const variantes = useVariantes();
  const now = new Date();

  const [pagosProximos, setPagosProximos] = useState<any[]>([]);
  const [notas, setNotas] = useState<any[]>([]);
  const [nuevaNota, setNuevaNota] = useState('');

  useEffect(() => {
    async function fetchData() {
      // Pagos
      const hoy = new Date(); hoy.setHours(0,0,0,0);
      const { data: pagosData } = await supabase.from('panel_pagos').select('*');
      if (pagosData) {
        setPagosProximos(pagosData.filter(p => {
          const f = new Date(p.fecha_vencimiento + 'T00:00:00');
          const diff = f.getTime() - hoy.getTime();
          const dias = Math.ceil(diff / (1000 * 60 * 60 * 24));
          return dias >= 0 && dias <= 5;
        }));
      }

      // Notas
      const { data: notasData } = await supabase.from('panel_notas').select('*').order('created_at', { ascending: false });
      if (notasData) setNotas(notasData);
    }
    fetchData();
  }, []);

  const handleAddNota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevaNota.trim()) return;
    const { data, error } = await supabase.from('panel_notas').insert({ contenido: nuevaNota }).select();
    if (!error && data) {
      setNotas([data[0], ...notas]);
      setNuevaNota('');
    }
  };

  const handleDeleteNota = async (id: string) => {
    await supabase.from('panel_notas').delete().eq('id', id);
    setNotas(notas.filter(n => n.id !== id));
  };

  const lastPost = useMemo(() => (queue.data ?? []).filter(x => x.status === 'posted' && x.posted_at).sort((a, b) => new Date(b.posted_at!).getTime() - new Date(a.posted_at!).getTime())[0], [queue.data]);
  const pending = useMemo(() => (queue.data ?? []).filter(x => x.status === 'pending'), [queue.data]);
  const todayPosts = useMemo(() => (queue.data ?? []).filter(x => x.status === 'posted' && x.posted_at && new Date(x.posted_at).toDateString() === now.toDateString()), [queue.data, now]);
  const lowStock = useMemo(() => (inv.data ?? []).filter(x => x.qty <= 5).sort((a, b) => a.qty - b.qty), [inv.data]);
  const queueErrors = useMemo(() => (queue.data ?? []).filter(x => x.status === 'error'), [queue.data]);

  const lastPostMin = lastPost ? Math.floor((now.getTime() - new Date(lastPost.posted_at!).getTime()) / 60000) : null;
  const systemAlive = lastPostMin !== null && lastPostMin < 1440 && pending.length > 0;
  const greeting = now.getHours() < 12 ? 'Buenos días' : now.getHours() < 19 ? 'Buenas tardes' : 'Buenas noches';

  const hasAlerts = pagosProximos.length > 0 || lowStock.length > 0 || queueErrors.length > 0;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">
      
      {/* HERO */}
      <div className="rounded-2xl p-6 lg:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6" style={{ background: 'var(--tx)', color: 'var(--cd)' }}>
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-60">
            <CircleDot size={12} style={{ color: systemAlive ? 'var(--ok)' : 'var(--er)' }} />
            {now.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' })} · {now.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold mt-3 tracking-tight">
            {queue.isLoading ? '…' : systemAlive ? `${greeting}, todo en marcha` : 'El sistema está parado'}
          </h1>
        </div>
        
        <div className="grid grid-cols-3 gap-6 bg-white/10 p-4 rounded-xl w-full md:w-auto">
          <div><div className="text-[10px] uppercase opacity-60">Último post</div><div className="text-sm font-semibold mt-1">{lastPost ? fmtAgo(lastPost.posted_at) : '—'}</div></div>
          <div><div className="text-[10px] uppercase opacity-60">Siguiente</div><div className="text-sm font-semibold mt-1 truncate max-w-[100px]">{pending[0]?.nombre ?? 'Sin cola'}</div></div>
          <div><div className="text-[10px] uppercase opacity-60">Hoy</div><div className="text-sm font-semibold mt-1">{todayPosts.length} publicados</div></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* COLUMNA IZQUIERDA */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Publicado hoy */}
          <section className="bg-cd bd rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4"><Send size={16} className="text-[var(--ac)]" /><h2 className="text-sm font-semibold">Publicado hoy</h2></div>
            {queue.isLoading && <Skeleton h={80} />}
            {!queue.isLoading && todayPosts.length === 0 && <div className="text-sm tx-mu py-6 text-center bg-sf rounded-lg border border-[var(--bd)] border-dashed">Aún no se ha publicado nada hoy.</div>}
            <div className="flex flex-col gap-2">
              {todayPosts.map(p => (
                <div key={p.id} className="flex items-center gap-4 p-3 bg-sf rounded-xl border border-[var(--bd)]">
                  {p.image_url ? <img src={p.image_url} className="w-12 h-12 rounded-lg object-cover bg-cd border border-[var(--bd)]" /> : <div className="w-12 h-12 rounded-lg bg-cd border border-[var(--bd)] grid place-items-center text-lg">📦</div>}
                  <div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{p.nombre ?? p.sku ?? '—'}</div><div className="text-[11px] tx-mu mono mt-0.5">{fmtAgo(p.posted_at)}</div></div>
                  <CheckCircle2 size={18} className="text-green-500" />
                </div>
              ))}
            </div>
          </section>

          {/* En cola */}
          <section className="bg-cd bd rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4"><Boxes size={16} className="text-[var(--mu)]" /><h2 className="text-sm font-semibold">En cola para publicar</h2></div>
            <div className="flex flex-col gap-2">
              {pending.slice(0, 3).map(p => (
                <div key={p.id} className="flex items-center gap-4 p-3 bg-sf rounded-xl border border-[var(--bd)]">
                  {p.image_url ? <img src={p.image_url} className="w-10 h-10 rounded-lg object-cover bg-cd border border-[var(--bd)]" /> : <div className="w-10 h-10 rounded-lg bg-cd border border-[var(--bd)] grid place-items-center text-sm">📦</div>}
                  <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{p.nombre ?? p.sku ?? '—'}</div></div>
                  <span className="chip mono">Pendiente</span>
                </div>
              ))}
              {pending.length > 3 && <Link to="/cola" className="text-xs text-[var(--ac)] font-semibold text-center mt-2 hover:underline">Ver todos los pendientes &rarr;</Link>}
              {pending.length === 0 && <div className="text-sm tx-mu text-center py-2">No hay productos en cola.</div>}
            </div>
          </section>
        </div>

        {/* COLUMNA DERECHA */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          
          {/* Alertas */}
          {hasAlerts && (
            <div className="rounded-2xl p-5 bg-cd bd shadow-sm border-t-4 border-t-orange-400">
              <div className="flex items-center gap-2 mb-4"><AlertTriangle size={16} className="text-orange-500" /><h2 className="text-sm font-bold text-orange-600">Centro de Alertas</h2></div>
              <div className="flex flex-col gap-3">
                {pagosProximos.map(p => (
                  <div key={p.id} className="flex flex-col gap-1 p-3 bg-orange-50 rounded-lg border border-orange-100">
                    <div className="flex justify-between items-center text-xs font-bold text-orange-700"><span>{p.nombre}</span><span>${p.monto.toFixed(2)}</span></div>
                    <Link to="/pagos" className="text-[10px] text-orange-600 hover:underline">Ir a pagar &rarr;</Link>
                  </div>
                ))}
                {lowStock.slice(0, 3).map(x => (
                  <div key={x.sku} className="flex justify-between items-center text-xs py-2 border-b border-[var(--bd)] last:border-0 last:pb-0">
                    <span className="font-medium text-[var(--tx)] truncate pr-2">{x.sku}</span>
                    <span className="font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded">{x.qty} uds</span>
                  </div>
                ))}
                {lowStock.length > 3 && <Link to="/catalogo" className="text-[10px] text-[var(--mu)] hover:text-[var(--tx)] text-center mt-1">+ {lowStock.length - 3} más con stock bajo</Link>}
              </div>
            </div>
          )}

          {/* Notas Rápidas */}
          <section className="bg-cd bd rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <StickyNote size={16} className="text-blue-500" />
              <h2 className="text-sm font-semibold">Notas Rápidas</h2>
            </div>
            
            <form onSubmit={handleAddNota} className="flex gap-2 mb-3">
              <input 
                type="text" 
                value={nuevaNota} 
                onChange={e => setNuevaNota(e.target.value)} 
                placeholder="Anotar algo..." 
                className="flex-1 bg-sf bd rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[var(--ac)]"
              />
              <button type="submit" className="bg-[var(--tx)] text-[var(--cd)] p-1.5 rounded-lg hover:opacity-80">
                <Plus size={14} />
              </button>
            </form>

            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
              {notas.map(nota => (
                <div key={nota.id} className="flex justify-between items-start p-2 bg-[var(--kb)] rounded-lg border border-[var(--bd)] group">
                  <div className="text-xs text-[var(--tx)] pr-2 break-words flex-1">{nota.contenido}</div>
                  <button onClick={() => handleDeleteNota(nota.id)} className="text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {notas.length === 0 && <div className="text-xs text-[var(--mu)] text-center py-2">No hay notas pendientes.</div>}
            </div>
          </section>

          {/* Catálogo Resumen */}
          <section className="bg-cd bd rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><Package size={16} className="text-[var(--mu)]" /><h2 className="text-sm font-semibold">Catálogo</h2></div>
              <Link to="/catalogo" className="text-[11px] text-[var(--ac)] hover:underline">Ver todo</Link>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="flex items-center justify-between p-3 bg-sf rounded-xl border border-[var(--bd)]">
                <div className="text-xs tx-mu uppercase font-semibold">Productos</div>
                <div className="text-lg font-bold">{productos.data?.length ?? '—'}</div>
              </div>
              <div className="flex items-center justify-between p-3 bg-sf rounded-xl border border-[var(--bd)]">
                <div className="text-xs tx-mu uppercase font-semibold">Variantes</div>
                <div className="text-lg font-bold">{variantes.data?.length ?? '—'}</div>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
