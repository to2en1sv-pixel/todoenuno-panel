import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Send, Bot, User } from 'lucide-react';

type Conversation = {
  id: string;
  instance_id: string;
  contact_name: string;
  contact_phone: string;
  last_message: string;
  status: string;
};

type Message = {
  id: string;
  conversation_id: string;
  body: string;
  from_me: boolean;
  created_at: string;
};

export function UniChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Cargar conversaciones iniciales y escuchar nuevas
  useEffect(() => {
    async function loadConversations() {
      const { data } = await supabase.from('bb_conversations').select('*').order('updated_at', { ascending: false });
      if (data) setConversations(data);
      setLoading(false);
    }
    loadConversations();

    // Suscripción en tiempo real
    const channel = supabase.channel('crm_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bb_conversations' }, (payload) => {
        loadConversations(); // Simplificado: recarga la lista cuando hay cambios
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bb_messages' }, (payload) => {
        const newMsg = payload.new as Message;
        if (selectedConv && newMsg.conversation_id === selectedConv.id) {
          setMessages((prev) => [...prev, newMsg]);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedConv]);

  // 2. Cargar mensajes al seleccionar un chat
  useEffect(() => {
    if (!selectedConv) return;
    async function loadMessages() {
      const { data } = await supabase
        .from('bb_messages')
        .select('*')
        .eq('conversation_id', selectedConv.id)
        .order('created_at', { ascending: true });
      if (data) setMessages(data);
    }
    loadMessages();
  }, [selectedConv]);

  // 3. Función para cambiar entre Bot y Humano
  const toggleStatus = async () => {
    if (!selectedConv) return;
    const newStatus = selectedConv.status === 'bot' ? 'human' : 'bot';
    
    // Actualizamos en Supabase (para que se refleje en el panel)
    await supabase.from('bb_conversations').update({ status: newStatus }).eq('id', selectedConv.id);
    setSelectedConv({ ...selectedConv, status: newStatus });

    // Aquí luego conectaremos con la API de BuilderBot (PATCH /conversations/:id)
    console.log(`Asignar chat a: ${newStatus}`);
  };

  return (
    <div className="flex h-[calc(100vh-100px)] bg-cd bd rounded-2xl overflow-hidden">
      
      {/* Lista de Chats (Izquierda) */}
      <div className="w-[300px] border-r border-[var(--bd)] flex flex-col">
        <div className="p-4 border-b border-[var(--bd)] bg-sf">
          <h2 className="font-bold">UniChat</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
            <div 
              key={conv.id} 
              onClick={() => setSelectedConv(conv)}
              className={`p-3 border-b border-[var(--bd)] cursor-pointer hover:bg-sf ${selectedConv?.id === conv.id ? 'bg-sf' : ''}`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-semibold text-sm">{conv.contact_name || conv.contact_phone}</span>
                <span className="text-[10px] chip">{conv.instance_id}</span>
              </div>
              <div className="text-xs tx-mu truncate">{conv.last_message}</div>
            </div>
          ))}
          {conversations.length === 0 && !loading && (
            <div className="p-4 text-center text-xs tx-mu">No hay chats aún.</div>
          )}
        </div>
      </div>

      {/* Ventana de Chat (Derecha) */}
      <div className="flex-1 flex flex-col bg-sf">
        {selectedConv ? (
          <>
            {/* Header del Chat */}
            <div className="p-4 border-b border-[var(--bd)] bg-cd flex justify-between items-center">
              <div>
                <h3 className="font-bold">{selectedConv.contact_name}</h3>
                <p className="text-xs tx-mu">{selectedConv.contact_phone}</p>
              </div>
              <button 
                onClick={toggleStatus}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 ${selectedConv.status === 'bot' ? 'bg-sf border border-[var(--bd)]' : 'bg-[var(--ac)] text-white'}`}
              >
                {selectedConv.status === 'bot' ? <><Bot size={14}/> Bot Activado</> : <><User size={14}/> Modo Humano</>}
              </button>
            </div>

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-cd">
              {messages.map((msg) => (
                <div key={msg.id} className={`max-w-[70%] p-2.5 rounded-xl text-sm ${msg.from_me ? 'self-end bg-[var(--tx)] text-[var(--cd)]' : 'self-start bg-sf border border-[var(--bd)]'}`}>
                  {msg.body}
                </div>
              ))}
            </div>

            {/* Input (Para responder manualmente) */}
            <div className="p-3 bg-cd border-t border-[var(--bd)] flex gap-2">
              <input type="text" placeholder="Escribe como humano..." className="flex-1 bg-sf bd rounded-lg px-3 py-2 text-sm outline-none" />
              <button className="bg-[var(--tx)] text-[var(--cd)] p-2 rounded-lg"><Send size={16}/></button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm tx-mu bg-cd">
            Selecciona un chat para comenzar
          </div>
        )}
      </div>

    </div>
  );
}
