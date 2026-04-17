// src/pages/Inbox.jsx
import { useState, useEffect } from 'react';
import { Search, Send, File, Paperclip, MoreVertical, SearchIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Inbox() {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');

  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/inbox/conversations', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.chats);
      }
    } catch (err) {
      console.error('Failed to fetch chats', err);
    } finally {
      setLoading(false);
    }
  };

  const selectChat = async (chat) => {
    setActiveChat(chat);
    try {
      const res = await fetch(`/api/inbox/messages/${chat.other_user_id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages);
      }
    } catch (err) {
      console.error('Failed to fetch messages', err);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeChat) return;

    try {
      const res = await fetch('/api/inbox/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          receiver_id: activeChat.other_user_id,
          content: newMessage
        })
      });

      if (res.ok) {
        const data = await res.json();
        setMessages([...messages, { 
          id: data.id, 
          sender_id: currentUser.id, 
          content: newMessage, 
          created_at: data.created_at 
        }]);
        setNewMessage('');
        fetchConversations(); // Refresh last message in sidebar
      }
    } catch (err) {
      console.error('Failed to send message', err);
    }
  };

  if (loading) {
    return (
      <div className="page-container container" style={{ display: 'flex', height: '80vh', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loader-spinner"></div>
      </div>
    );
  }

  return (
    <div className="page-container container" style={{ display: 'flex', height: 'calc(100vh - 4rem)', paddingBottom: '0' }}>
      
      {/* Sidebar: Conversation List */}
      <div className="inbox-sidebar glass-panel">
        <div className="inbox-header font-display">
          <h2>Messages</h2>
          <button className="icon-btn tooltip-target"><File size={18} /><span>New Message</span></button>
        </div>
        
        <div className="search-bar" style={{ margin: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '20px', display: 'flex', padding: '0.5rem 1rem' }}>
          <SearchIcon size={16} className="text-muted" style={{ marginRight: '0.5rem' }} />
          <input type="text" placeholder="Search chats..." style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', flex: 1, outline: 'none' }} />
        </div>

         <div className="chat-list custom-scrollbar">
          {conversations.map(chat => (
            <div 
              key={chat.other_user_id} 
              className={`chat-item ${activeChat?.other_user_id === chat.other_user_id ? 'active' : ''}`}
              onClick={() => selectChat(chat)}
            >
              <div className="avatar" style={{ background: chat.role === 'admin' ? 'var(--warning)' : 'var(--bg-gradient-primary)' }}>
                {chat.first_name?.[0]}
              </div>
              <div className="chat-info">
                <div className="chat-name-row">
                  <h4>{chat.first_name} {chat.last_name}</h4>
                  {chat.unread_count > 0 && <span className="unread-badge">{chat.unread_count}</span>}
                </div>
                <p className="chat-preview">{chat.last_message}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="inbox-main glass-panel">
        {activeChat ? (
          <>
            <div className="chat-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div className="avatar" style={{ background: activeChat.role === 'admin' ? 'var(--warning)' : 'var(--bg-gradient-primary)' }}>{activeChat.first_name?.[0]}</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{activeChat.first_name} {activeChat.last_name}</h3>
                  <span className="text-muted text-sm">{activeChat.role}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="icon-btn tooltip-target"><Search size={20} /><span>Search Chat</span></button>
                <button className="icon-btn tooltip-target"><MoreVertical size={20} /><span>Options</span></button>
              </div>
            </div>

            <div className="chat-messages custom-scrollbar">
              {messages.map((msg, i) => {
                const isMine = msg.sender_id === currentUser.id;
                return (
                  <div key={msg.id} className={`message-wrapper ${isMine ? 'mine' : 'theirs'}`}>
                    <div className="message-bubble">
                      <p>{msg.content}</p>
                      <span className="message-time">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <form className="chat-input-area" onSubmit={handleSend}>
              <button type="button" className="icon-btn tooltip-target" style={{ border: 'none' }}>
                <Paperclip size={20} className="text-muted" /><span>Attach File</span>
              </button>
              <input 
                type="text" 
                placeholder="Type a message..." 
                className="input-glass"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                style={{ flex: 1, border: 'none', background: 'rgba(0,0,0,0.3)', borderRadius: '20px', padding: '0.8rem 1.5rem' }}
              />
              <button type="submit" className="send-btn" disabled={!newMessage.trim()}>
                <Send size={18} />
              </button>
            </form>
          </>
        ) : (
          <div className="empty-chat-state text-center text-muted">
            <Send size={48} style={{ opacity: 0.2, margin: '0 auto 1.5rem auto' }} />
            <h2 className="font-display text-primary">Your Inbox</h2>
            <p>Select a conversation from the sidebar to start messaging.</p>
          </div>
        )}
      </div>

      <style>{`
        .inbox-sidebar {
          width: 320px;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--glass-border);
          flex-shrink: 0;
          border-radius: 16px 0 0 16px;
        }
        .inbox-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.5rem;
          border-bottom: 1px solid var(--glass-border);
        }
        .chat-list {
          flex: 1;
          overflow-y: auto;
        }
        .chat-item {
          display: flex;
          gap: 1rem;
          padding: 1rem 1.5rem;
          cursor: pointer;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          transition: background 0.2s;
        }
        .chat-item:hover { background: rgba(255,255,255,0.02); }
        .chat-item.active { background: rgba(255,255,255,0.05); border-left: 3px solid var(--accent-primary); }
        
        .chat-info { flex: 1; min-width: 0; }
        .chat-name-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem; }
        .chat-name-row h4 { margin: 0; font-size: 1rem; color: var(--text-primary); }
        .unread-badge { background: var(--danger); color: white; border-radius: 10px; padding: 0.1rem 0.4rem; font-size: 0.7rem; font-weight: bold; }
        .chat-preview { font-size: 0.85rem; color: var(--text-secondary); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        
        .inbox-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          border-radius: 0 16px 16px 0;
          border-left: none;
        }
        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.25rem 2rem;
          border-bottom: 1px solid var(--glass-border);
          background: rgba(0,0,0,0.1);
        }
        
        .chat-messages {
          flex: 1;
          padding: 2rem;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .message-wrapper { display: flex; flex-direction: column; }
        .message-wrapper.mine { align-items: flex-end; }
        .message-wrapper.theirs { align-items: flex-start; }
        
        .message-bubble {
          max-width: 70%;
          padding: 0.8rem 1.2rem;
          border-radius: 16px;
          position: relative;
        }
        .message-wrapper.mine .message-bubble {
          background: var(--accent-primary);
          color: white;
          border-bottom-right-radius: 4px;
        }
        .message-wrapper.theirs .message-bubble {
          background: rgba(255,255,255,0.1);
          color: var(--text-primary);
          border-bottom-left-radius: 4px; border: 1px solid var(--glass-border);
        }
        .message-bubble p { margin: 0 0 0.4rem 0; line-height: 1.4; }
        .message-time { font-size: 0.7rem; color: rgba(255,255,255,0.6); display: block; text-align: right; }
        
        .chat-input-area {
          padding: 1.5rem;
          border-top: 1px solid var(--glass-border);
          display: flex;
          gap: 1rem;
          align-items: center;
          background: rgba(0,0,0,0.1);
        }
        .send-btn {
          width: 44px; height: 44px;
          border-radius: 50%; border: none;
          background: var(--accent-primary); color: white;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: transform 0.2s, background 0.2s;
        }
        .send-btn:hover:not(:disabled) { transform: scale(1.05); }
        .send-btn:disabled { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.3); cursor: not-allowed; }
        
        .empty-chat-state {
          flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
        }
        
        @media (max-width: 768px) {
          .inbox-sidebar { width: 100%; display: ${activeChat ? 'none' : 'flex'}; border-radius: 16px; }
          .inbox-main { display: ${activeChat ? 'flex' : 'none'}; border-radius: 16px; }
        }
      `}</style>
    </div>
  );
}
