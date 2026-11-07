import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Save, Trash2, FileText, CheckCircle2, Clock, LayoutList } from 'lucide-react';

type Doc = {
  id: string;
  titulo: string;
  contenido: string;
  categoria: string;
  estado: string;
  updated_at: string;
};

export function DocsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Formulario local
  const [titulo, setTitulo] = useState('');
  const [contenido, setContenido] = useState('');
  const [categoria, setCategoria] = useState('General');
  const [estado, setEstado] = useState('En Progreso');

  useEffect(() => {
    loadDocs();
  }, []);

  const STARTER_DOCS: Doc[] = [
    {
      id: 'doc-os-roadmap',
      titulo: 'Arquitectura: Núcleo OS Events (8 Fases)',
      categoria: 'Roadmap',
      estado: 'En Progreso',
      updated_at: new Date().toISOString(),
      contenido: `# TODOENUNO OS — NÚCLEO DE EVENTOS

Principio Rector:
"No construyamos OS Events como una tabla. Construyámoslo como el núcleo de TodoEnUno OS."

Ciclo de Vida Unificado:
1. Cliente escribió (chat.message.received)
2. Lead generado (lead.generated)
3. Pedido creado (order.created)
4. Pedido confirmado (order.confirmed)
5. Pedido enviado (order.shipped)
6. Pedido entregado (order.delivered)
7. Dinero cobrado (finance.income.created)

Roadmap Oficial de 8 Fases:
- FASE 0: Auditoría y Congelación (docs/os-events-map.md)
- FASE 1: Crear OS Event Store (schema os, os.events, os.event_types, os.event_consumers)
- FASE 2: Normalización de Lenguaje Único (order.*, chat.*, marketing.*, supplier.*)
- FASE 3: Order Event Producer (trigger whatsapp_orders)
- FASE 4: Marketing Event Producer (gastos_publicidad, fb_leads, post_queue)
- FASE 5: Supplier Event Producer (proveedores, licitaciones)
- FASE 6: Money Engine (Finance Projector consumidor)
- FASE 7: OS Memory (memory.facts, daily snapshots)
- FASE 8: Intelligence Layer (Copilot & Agentes IA)`
    },
    {
      id: 'doc-sprint1-guide',
      titulo: 'Sprint 1: Guía de Despliegue SQL y Pruebas',
      categoria: 'Fase',
      estado: 'Completado',
      updated_at: new Date().toISOString(),
      contenido: `# SPRINT 1 — ESPECIFICACIÓN Y GUÍA DE ACTIVACIÓN

Archivos creados en el repositorio:
1. docs/20261107_sprint1_os_event_store.sql
2. docs/os-events-map.md
3. src/lib/osEvents.ts
4. src/components/events/EventStreamViewer.tsx
5. src/pages/EventStreamPage.tsx

Paso a Paso en Supabase:
1. Ir al Dashboard de Supabase -> SQL Editor.
2. Pegar el contenido del script 'docs/20261107_sprint1_os_event_store.sql'.
3. Ejecutar (Run).
4. Verificar en el panel en la ruta /event-stream o en Sistema -> Event Stream.`
    }
  ];

  async function loadDocs() {
    try {
      const { data } = await supabase.from('panel_docs').select('*').order('updated_at', { ascending: false });
      if (data && data.length > 0) {
        setDocs(data);
        if (!selectedDoc) handleSelect(data[0]);
      } else {
        setDocs(STARTER_DOCS);
        if (!selectedDoc) handleSelect(STARTER_DOCS[0]);
      }
    } catch {
      setDocs(STARTER_DOCS);
      if (!selectedDoc) handleSelect(STARTER_DOCS[0]);
    }
    setLoading(false);
  }

  const handleSelect = (doc: Doc) => {
    setSelectedDoc(doc);
    setTitulo(doc.titulo);
    setContenido(doc.contenido);
    setCategoria(doc.categoria);
    setEstado(doc.estado);
  };

  const handleCreate = async () => {
    const { data, error } = await supabase.from('panel_docs').insert({
      titulo: 'Nuevo Documento',
      contenido: '',
      categoria: 'General',
      estado: 'Pendiente'
    }).select();

    if (!error && data) {
      setDocs([data[0], ...docs]);
      handleSelect(data[0]);
    }
  };

  const handleSave = async () => {
    if (!selectedDoc) return;
    setIsSaving(true);
    
    const { error } = await supabase.from('panel_docs').update({
      titulo,
      contenido,
      categoria,
      estado,
      updated_at: new Date().toISOString()
    }).eq('id', selectedDoc.id);

    if (!error) {
      const updatedDoc = { ...selectedDoc, titulo, contenido, categoria, estado, updated_at: new Date().toISOString() };
      setSelectedDoc(updatedDoc);
      setDocs(docs.map(d => d.id === selectedDoc.id ? updatedDoc : d).sort((a,b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
      // Toast simple
      const btn = document.getElementById('save-btn');
      if(btn) {
        btn.innerText = '¡Guardado!';
        setTimeout(() => { if(btn) btn.innerText = 'Guardar Cambios'; }, 2000);
      }
    }
    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este documento permanentemente?')) return;
    await supabase.from('panel_docs').delete().eq('id', id);
    const remaining = docs.filter(d => d.id !== id);
    setDocs(remaining);
    if (selectedDoc?.id === id) {
      if (remaining.length > 0) handleSelect(remaining[0]);
      else { setSelectedDoc(null); setTitulo(''); setContenido(''); }
    }
  };

  const getStatusIcon = (status: string) => {
    if (status === 'Completado') return <CheckCircle2 size={14} className="text-green-500" />;
    if (status === 'En Progreso') return <Clock size={14} className="text-orange-500" />;
    return <LayoutList size={14} className="text-gray-400" />;
  };

  return (
    <div className="flex h-[calc(100vh-120px)] lg:h-[calc(100vh-100px)] bg-cd bd rounded-2xl overflow-hidden flex-col lg:flex-row shadow-sm">
      
      {/* Sidebar de Documentos */}
      <div className="w-full lg:w-[300px] border-r border-[var(--bd)] flex flex-col bg-sf">
        <div className="p-4 border-b border-[var(--bd)] flex justify-between items-center bg-cd">
          <h2 className="font-bold flex items-center gap-2"><FileText size={18}/> Docs & Roadmap</h2>
          <button onClick={handleCreate} className="bg-[var(--tx)] text-[var(--cd)] p-1.5 rounded-lg hover:opacity-80" title="Nuevo Documento">
            <Plus size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-4 text-xs text-center tx-mu">Cargando...</div>}
          {docs.map(doc => (
            <div 
              key={doc.id} 
              onClick={() => handleSelect(doc)}
              className={`p-3 border-b border-[var(--bd)] cursor-pointer transition-colors group ${selectedDoc?.id === doc.id ? 'bg-cd border-l-4 border-l-[var(--ac)]' : 'hover:bg-cd'}`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-semibold text-sm truncate pr-2">{doc.titulo}</span>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }} className="text-red-400 opacity-0 group-hover:opacity-100 hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex items-center gap-2 text-[10px] tx-mu uppercase">
                {getStatusIcon(doc.estado)} {doc.estado} • {doc.categoria}
              </div>
            </div>
          ))}
          {docs.length === 0 && !loading && <div className="p-4 text-xs text-center tx-mu">No hay documentos. Crea uno nuevo.</div>}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col bg-cd">
        {selectedDoc ? (
          <>
            <div className="p-4 border-b border-[var(--bd)] flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
              <input 
                type="text" 
                value={titulo} 
                onChange={e => setTitulo(e.target.value)} 
                className="text-xl font-bold bg-transparent outline-none flex-1 border-b border-transparent focus:border-[var(--ac)] transition-colors w-full"
                placeholder="Título del Documento"
              />
              <div className="flex items-center gap-2">
                <select value={categoria} onChange={e => setCategoria(e.target.value)} className="bg-sf border border-[var(--bd)] rounded-lg px-2 py-1 text-xs outline-none">
                  <option value="General">General</option>
                  <option value="Roadmap">Roadmap</option>
                  <option value="Fase">Fase</option>
                  <option value="Idea">Idea</option>
                </select>
                <select value={estado} onChange={e => setEstado(e.target.value)} className="bg-sf border border-[var(--bd)] rounded-lg px-2 py-1 text-xs outline-none">
                  <option value="Pendiente">Pendiente</option>
                  <option value="En Progreso">En Progreso</option>
                  <option value="Completado">Completado</option>
                </select>
                <button 
                  id="save-btn"
                  onClick={handleSave} 
                  disabled={isSaving}
                  className="bg-[var(--ac)] text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 hover:opacity-90 transition-opacity"
                >
                  <Save size={14} /> {isSaving ? '...' : 'Guardar Cambios'}
                </button>
              </div>
            </div>
            
            <textarea
              value={contenido}
              onChange={e => setContenido(e.target.value)}
              className="flex-1 w-full p-6 bg-cd text-sm outline-none resize-none font-mono leading-relaxed"
              placeholder="Escribe aquí tus ideas, roadmaps, notas de la fase, requerimientos técnicos..."
            />
            <div className="p-2 border-t border-[var(--bd)] text-[10px] text-right tx-mu">
              Última actualización: {new Date(selectedDoc.updated_at).toLocaleString('es-SV')}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-sm tx-mu gap-2">
            <FileText size={48} className="opacity-20" />
            Selecciona o crea un documento para comenzar
          </div>
        )}
      </div>
    </div>
  );
}
