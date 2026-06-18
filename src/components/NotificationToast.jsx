import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Bell, Users, Megaphone } from 'lucide-react';
import { resolveMediaUrl } from '../utils/mediaUtils';
import './NotificationToast.css';

export default function NotificationToast() {
  const [toasts, setToasts] = useState([]);
  const navigate = useNavigate();

  function dismissToast(toastId) {
    setToasts((prev) =>
      prev.map((t) => (t.id === toastId ? { ...t, isDismissing: true } : t))
    );

    // Wait for slide-out animation to complete, then remove from state
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 500); // Matches CSS slide-out animation length
  }

  useEffect(() => {
    const handleNewNotification = (event) => {
      const notification = event.detail;
      if (!notification) return;

      const toastId = Date.now() + Math.random().toString(36).substring(2, 7);
      const newToast = {
        id: toastId,
        notifId: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        link: notification.link,
        sender_name: notification.sender_name,
        sender_avatar: notification.sender_avatar,
        image_url: notification.image_url,
        created_at: notification.created_at,
        isDismissing: false,
        isRead: false,
      };

      // Add to toasts stack
      setToasts((prev) => [...prev, newToast]);

      // Play a subtle notification chime sound if available
      try {
        const audio = new Audio(`${import.meta.env.BASE_URL || '/'}sound/notification.mp3`);
        audio.volume = 0.4;
        audio.play().catch(() => {
          // Ignore audio play block by browser autoplay policy
        });
      } catch {
        // Ignore
      }

      // Auto dismiss after 6 seconds
      setTimeout(() => {
        dismissToast(toastId);
      }, 6000);
    };

    window.addEventListener('showNotificationToast', handleNewNotification);
    return () => {
      window.removeEventListener('showNotificationToast', handleNewNotification);
    };
  }, []);

  const handleMouseEnter = async (toast) => {
    if (toast.isRead || !toast.notifId) return;

    // Mark as read in state immediately so UI updates
    setToasts((prev) =>
      prev.map((t) => (t.id === toast.id ? { ...t, isRead: true } : t))
    );

    // Call backend API to mark as read
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/notifications/${toast.notifId}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });

      // Fetch new unread count and dispatch event to sync badge
      const countRes = await fetch('/api/notifications/unread-count', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (countRes.ok) {
        const countData = await countRes.json();
        const unreadCount = countData.unreadCount || 0;
        
        window.dispatchEvent(
          new CustomEvent('updateUnreadNotifications', {
            detail: unreadCount,
          })
        );
        
        // Dispatch refresh notifications event to update panel
        window.dispatchEvent(new CustomEvent('refreshNotifications'));
      }
    } catch (error) {
      console.error('Failed to mark notification as read on hover', error);
    }
  };

  const handleToastClick = async (toast) => {
    dismissToast(toast.id);

    // Navigate to link
    if (toast.link) {
      navigate(toast.link);
      
      // If it's a community post link, dispatch a custom event so that Community.jsx
      // can force scroll-and-highlight even if the hash hasn't changed.
      if (toast.link.includes('/community#post-')) {
        const postId = toast.link.split('#post-')[1];
        window.dispatchEvent(
          new CustomEvent('triggerPostHighlight', { detail: postId })
        );
      }
    }

    // Mark as read in backend if not already done on hover
    if (toast.notifId && !toast.isRead) {
      try {
        const token = localStorage.getItem('token');
        await fetch(`/api/notifications/${toast.notifId}/read`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
        });

        // Fetch new unread count and dispatch event to sync badge
        const countRes = await fetch('/api/notifications/unread-count', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (countRes.ok) {
          const countData = await countRes.json();
          window.dispatchEvent(
            new CustomEvent('updateUnreadNotifications', {
              detail: countData.unreadCount || 0,
            })
          );
          window.dispatchEvent(new CustomEvent('refreshNotifications'));
        }
      } catch (error) {
        console.error('Failed to mark notification as read from toast click', error);
      }
    }
  };

  if (toasts.length === 0) return null;

  return (
    <div className="notification-toast-container">
      {toasts.map((toast) => {
        const isNotice = toast.type === 'notice';
        const isCommunity = toast.type === 'community';

        return (
          <div
            key={toast.id}
            className={`notification-toast ${toast.isDismissing ? 'dismissing' : ''}`}
            onClick={() => handleToastClick(toast)}
            onMouseEnter={() => handleMouseEnter(toast)}
          >
            <div className="toast-header">
              <span className="toast-header-title">
                {isNotice ? 'Announcement' : isCommunity ? 'Community' : 'Notification'}
              </span>
              <button
                type="button"
                className="toast-close-btn"
                onClick={(e) => {
                  e.stopPropagation(); // prevent triggering navigate
                  dismissToast(toast.id);
                }}
                aria-label="Dismiss notification"
              >
                <X size={12} />
              </button>
            </div>
            
            <div className="toast-body">
              <div className="toast-avatar-container">
                <img
                  src={
                    toast.sender_avatar
                      ? resolveMediaUrl(toast.sender_avatar)
                      : `${import.meta.env.BASE_URL || '/'}avatars/male1.png`
                  }
                  alt={toast.sender_name || 'User'}
                  className="toast-avatar"
                  onError={(e) => {
                    e.target.src = `${import.meta.env.BASE_URL || '/'}avatars/male1.png`;
                  }}
                />
                <div className={`toast-badge ${toast.type}`}>
                  {isNotice ? (
                    <Megaphone size={10} />
                  ) : isCommunity ? (
                    <Users size={10} />
                  ) : (
                    <Bell size={10} />
                  )}
                </div>
              </div>

              <div className="toast-content">
                <div className="toast-text">
                  {formatToastMessage(toast.message, toast.sender_name)}
                </div>
                <span className="toast-time">Just now</span>
              </div>

              {toast.image_url && (() => {
                const attachment = parseAttachment(toast.image_url);
                if (!attachment || !attachment.url) return null;
                const isImage = attachment.type?.startsWith('image/');
                if (isImage) {
                  return (
                    <div className="toast-thumbnail">
                      <img
                        src={resolveMediaUrl(attachment.url)}
                        alt="thumbnail"
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>
                  );
                }
                return null;
              })()}

              <div className="toast-status-col">
                {!toast.isRead && <div className="toast-unread-dot" />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Helper function to format bold parts of message
function formatToastMessage(message, senderName) {
  if (!message) return '';
  if (senderName && message.startsWith(senderName)) {
    const rest = message.slice(senderName.length);
    return (
      <>
        <strong>{senderName}</strong>
        {rest}
      </>
    );
  }
  
  // Basic match fallback (e.g. check for quotes)
  const parts = message.split(/("[^"]*")/g);
  return parts.map((part, i) => {
    if (part.startsWith('"') && part.endsWith('"')) {
      return <strong key={i}>{part}</strong>;
    }
    return part;
  });
}

function parseAttachment(value) {
  if (!value) return null;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      return JSON.parse(value);
    } catch {
      // ignore
    }
  }
  return {
    name: 'attachment_image.png',
    type: 'image/png',
    url: value
  };
}
