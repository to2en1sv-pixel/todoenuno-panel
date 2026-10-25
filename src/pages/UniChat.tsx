import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Send, Bot, User, Loader2 } from 'lucide-react';

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
  const [isUpdating, setIsUpdating] = useState(false);
  
  // Estado temporal para el input (lo usaremos en la Opción 2)
  const [inputText, setInputText] = useState('');

  // 1. Cargar conversaciones iniciales y escuchar nuevas
  useEffect(() => {
    async function loadConversations() {
      const { data } = await supabase
        .from('bb_conversations')
        .select('*')
        .order('updated_at', { ascending: false });
      if (data) setConversations(data);
      setLoading(false);
    }
    loadConversations();

    // Suscripción en tiempo real
    const channel = supabase.channel('crm_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bb_conversations' }, () => {
        loadConversations(); 
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bb_messages' }, (payload) => {
        const newMsg = payload.new as Message;
        // Usamos una función de actualización de estado para evitar dependencias circulares
        setSelectedConv((current) => {
          if (current && newMsg.conversation_id === current.id) {
            setMessages((prev) => {
              // Evitar duplicados si Supabase Realtime dispara doble
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
          }
          return current;
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // 2. Cargar mensajes al seleccionar un chat
  useEffect(() => {
    if (!selectedConv) return;
    
    async function loadMessages() {
      const { data } = await supabase
        .from('bb_messages')
        .select('*')
        .eq('conversation_id', selectedConv?.id)
        .order('created_at', { ascending: true });
      if (data) setMessages(data);
    }
    loadMessages();
  }, [selectedConv?.id]);

  // 3. Función para cambiar entre Bot y Humano
  const toggleStatus = async () => {
    if (!selectedConv || isUpdating) return;
    
    setIsUpdating(true);
    const newStatus = selectedConv.status === 'bot' ? 'human' : 'bot';
    
    try {
      // Llamamos a nuestra API Serverless en Vercel
      const res = await fetch('/api/toggle-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selectedConv.id,
          action: newStatus,
          instanceId: selectedConv.instance_id
        })
      });

      if (!res.ok) throw new Error('Error al actualizar en BuilderBot');

      // Actualizamos la vista local inmediatamente
      const updatedConv = { ...selectedConv, status: newStatus };
      setSelectedConv(updatedConv);
      
      // Actualizamos también la lista de la izquierda
      setConversations(prev => 
        prev.map(c => c.id === selectedConv.id ? updatedConv : c)
      );

    } catch (error) {
      console.error(error);
      alert('No se pudo cambiar el modo. Revisa que las variables de entorno en Vercel estén bien configuradas.');
    } finally {
      setIsUpdating(false);
    }
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
              className={`p-3 border-b border-[var(--bd)] cursor-pointer hover:bg-sf transition-colors ${selectedConv?.id === conv.id ? 'bg-sf border-l-4 border-l-[var(--ac)]' : ''}`}
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
              
              {/* BOTÓN DE MODO HUMANO/BOT */}
              <button 
                onClick={toggleStatus}
                disabled={isUpdating}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
                  selectedConv.status === 'bot' 
                    ? 'bg-sf border border-[var(--bd)] hover:bg-gray-200 text-gray-700' 
                    : 'bg-[var(--ac)] text-white hover:opacity-90'
                } ${isUpdating ? 'opacity-50 cursor-wait' : ''}`}
              >
                {isUpdating ? (
                  <><Loader2 size={14} className="animate-spin" /> Cambiando...</>
                ) : selectedConv.status === 'bot' ? (
                  <><Bot size={14}/> Bot Activado</>
                ) : (
                  <><User size={14}/> Modo Humano</>
                )}
