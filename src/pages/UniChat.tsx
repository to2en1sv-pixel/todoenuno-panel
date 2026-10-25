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
  const [isSending, setIsSending] = useState(false);
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

    const channel = supabase.channel('crm_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bb_conversations' }, () => {
        loadConversations(); 
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bb_messages' }, (payload) => {
        const newMsg = payload.new as Message;
        setSelectedConv((current) => {
          if (current && newMsg.conversation_id === current.id) {
            setMessages((prev) => {
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

  // 3. Cambiar entre Bot y Humano
  const toggleStatus = async () => {
    if (!selectedConv || isUpdating) return;
    
    setIsUpdating(true);
    const newStatus = selectedConv.status === 'bot' ? 'human' : 'bot';
    
    try {
      const res = await fetch('/api/toggle-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selectedConv.id,
          action: newStatus,
          instanceId: selectedConv.instance_id
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || 'Error al actualizar');

      const updatedConv = { ...selectedConv, status: newStatus };
      setSelectedConv(updatedConv);
      setConversations(prev => prev.map(c => c.id === selectedConv.id ? updatedConv : c));

    } catch (error: any) {
      console.error(error);
      alert(`No se pudo cambiar el modo: ${error.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // 4. Enviar mensaje (Sin contactPhone, usando V1)
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedConv || isSending) return;

    const textToSend = inputText;
    setInputText('');
    setIsSending(true);

    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: selectedConv.id,
          text: textToSend,
          instanceId: selectedConv.instance_id
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || 'Error en el servidor');
      
    } catch (error: any) {
      console.error('Error al enviar:', error);
      setInputText(textToSend); 
      alert(`No se pudo enviar el mensaje: ${error.message}`);
    } finally {
      setIsSending(false);
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

            {/* Input */}
            <form onSubmit={handleSendMessage} className="p-3 bg-cd border-t border-[var(--bd)] flex gap-2">
              <input 
                type="text" 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Escribe como humano..." 
                disabled={isSending}
                className="flex-1 bg-sf bd rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--ac)] disabled:opacity-50" 
              />
              <button 
                type="submit" 
                disabled={isSending || !inputText.trim()}
                className="bg-[var(--tx)] text-[var(--cd)] p-2 rounded-lg hover:opacity-80 transition-opacity disabled:opacity-50 flex items-center justify-center w-10"
              >
                {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16}/>}
              </button>
            </form>
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
