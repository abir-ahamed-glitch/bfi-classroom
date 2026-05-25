import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, Trash2, Megaphone, Users, User, X } from 'lucide-react';
import { resolveMediaUrl } from '../utils/mediaUtils';
import './NotificationPanel.css';

export default function NotificationPanel({ isOpen, onClose }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  useEffect(() => {
    // Also fetch initially to set the badge even when closed
    fetchUnreadCount();
  }, []);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        fetchUnreadCount();
      }
    } catch (error) {
      console.error('Failed to fetch notifications', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await fetch('/api/notifications/unread-count', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const count = data.unreadCount || 0;
        setUnreadCount(count);
        window.dispatchEvent(new CustomEvent('updateUnreadNotifications', { detail: count }));
      }
    } catch (error) {
      console.error('Failed to fetch unread count', error);
    }
  };

  const markAsRead = async (id, link) => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/notifications/${id}/read`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
      setUnreadCount(prev => {
        const newCount = Math.max(0, prev - 1);
        window.dispatchEvent(new CustomEvent('updateUnreadNotifications', { detail: newCount }));
        return newCount;
      });
      
      if (link) {
        navigate(link);
        onClose();
        // If it's a community post link, dispatch a custom event so that Community.jsx
        // can force scroll-and-highlight even if the hash hasn't changed.
        if (link.includes('/community#post-')) {
          const postId = link.split('#post-')[1];
          window.dispatchEvent(new CustomEvent('triggerPostHighlight', { detail: postId }));
        }
      }
    } catch (error) {
      console.error('Failed to mark as read', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const token = localStorage.getItem('token');
      await fetch('/api/notifications/read-all', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      setUnreadCount(0);
      window.dispatchEvent(new CustomEvent('updateUnreadNotifications', { detail: 0 }));
    } catch (error) {
      console.error('Failed to mark all as read', error);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="notification-backdrop" onClick={onClose}></div>
      <div className="notification-panel" ref={panelRef}>
        <div className="notification-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bell size={20} />
            <h3>Notifications</h3>
            {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            {unreadCount > 0 && (
              <button className="mark-all-btn" onClick={markAllAsRead} title="Mark all as read">
                <Check size={16} /> Mark all read
              </button>
            )}
            <button className="close-panel-btn" onClick={onClose}><X size={20} /></button>
          </div>
        </div>

        <div className="notification-list">
          {loading ? (
            <div className="notification-loading">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="notification-empty">
              <Bell size={40} style={{ opacity: 0.2, marginBottom: '1rem' }} />
              <p>No notifications yet</p>
            </div>
          ) : (
            notifications.map(notif => (
              <div 
                key={notif.id} 
                className={`notification-item ${notif.is_read ? 'read' : 'unread'}`}
                onClick={() => markAsRead(notif.id, notif.link)}
              >
                <div className="notification-icon">
                  {notif.type === 'notice' ? <Megaphone size={18} /> :
                   notif.type === 'community' ? <Users size={18} /> :
                   <Bell size={18} />}
                </div>
                <div className="notification-content" style={{ display: 'flex', gap: '10px', width: '100%' }}>
                  <div style={{ flex: 1 }}>
                    <h4>{notif.title}</h4>
                    <p style={{ margin: '4px 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{notif.message}</p>
                    <span className="notification-time">
                      {new Date(notif.created_at).toLocaleString(undefined, { 
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                      })}
                    </span>
                  </div>
                  {notif.image_url && (
                    <div className="notification-thumbnail" style={{
                      width: '40px',
                      height: '40px',
                      flexShrink: 0,
                      borderRadius: '8px',
                      overflow: 'hidden',
                      background: 'var(--bg-glass)',
                      border: '1px solid var(--border-color)'
                    }}>
                      <img 
                        src={resolveMediaUrl(notif.image_url)} 
                        alt="attachment" 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => e.target.style.display = 'none'}
                      />
                    </div>
                  )}
                </div>
                {!notif.is_read && <div className="unread-dot"></div>}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
