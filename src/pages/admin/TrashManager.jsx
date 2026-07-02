import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trash2, RefreshCcw, AlertTriangle, Search, Filter, X, CheckSquare, Square, RotateCcw, Calendar, Trash, CheckCircle2 } from 'lucide-react';
import { useModal } from '../../components/BFIModal';
import { io } from 'socket.io-client';
import './TrashManager.css';

const TABS = [
  { id: 'dashboard', label: 'Live Dashboard' },
  { id: 'students', label: 'Students' },
  { id: 'leads', label: 'Leads' },
  { id: 'teachers', label: 'Teachers' },
  { id: 'batches', label: 'Batches' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'broadcasts', label: 'Broadcasts' },
  { id: 'posts', label: 'Community Posts' },
  { id: 'materials', label: 'Course Materials' },
  { id: 'projects', label: 'Projects' }
];

const getImageUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return url.startsWith('/') ? url : `/${url}`;
};

export default function TrashManager() {
  const { showConfirm } = useModal();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const activeTab = TABS.find(t => t.id === urlTab) ? urlTab : TABS[0].id;
  
  const setActiveTab = (tabId) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev);
      newParams.set('tab', tabId);
      return newParams;
    });
  };
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  
  // Toast state
  const [toast, setToast] = useState(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [deletedBy, setDeletedBy] = useState('');
  const [admins, setAdmins] = useState([]);

  // Fetch Admins
  useEffect(() => {
    const fetchAdmins = async () => {
      try {
        const res = await fetch('/api/admin/trash/admins', { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
        const data = await res.json();
        if (data.admins) setAdmins(data.admins);
      } catch (err) {
        console.error('Failed to fetch admins:', err);
      }
    };
    fetchAdmins();
  }, []);

  const showToastMsg = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchTrashItems = async () => {
    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    try {
      const endpoint = activeTab === 'dashboard' ? 'audit-log' : activeTab;
      const res = await fetch(`/api/admin/trash/${endpoint}?t=${Date.now()}`, {
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
      if (!res.ok) {
        let errText = '';
        try { errText = await res.text(); } catch(e) {}
        throw new Error(`Failed to fetch (${res.status}): ${errText}`);
      }
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrashItems();
  }, [activeTab]);

  // Live updates via Socket.IO
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    const socket = io(socketUrl, {
      withCredentials: true,
      auth: { token: localStorage.getItem('token') },
      transports: ['websocket', 'polling'],
    });

    socket.on('trash_updated', (payload) => {
      // Re-fetch items when trash is updated by any admin
      fetchTrashItems();
      
      // Optionally show a subtle toast if we are on the relevant tab
      if (activeTab === payload.entityType || activeTab === 'dashboard') {
        showToastMsg('Trash updated remotely', 'success');
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [activeTab]);

  const handleRestore = async (id) => {
    if (!await showConfirm('Restore Item', 'Are you sure you want to restore this item?')) return;
    try {
      const res = await fetch(`/api/admin/trash/restore/${activeTab}/${id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        showToastMsg('Item restored successfully');
        fetchTrashItems();
      }
    } catch (err) {
      console.error('Error restoring item:', err);
    }
  };

  const handlePermanentDelete = async (id) => {
    if (!await showConfirm('Permanent Delete', 'Are you sure you want to permanently delete this item? This action cannot be undone!', 'danger')) return;
    try {
      const res = await fetch(`/api/admin/trash/permanent/${activeTab}/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        showToastMsg('Item permanently deleted');
        fetchTrashItems();
      }
    } catch (err) {
      console.error('Error permanently deleting item:', err);
    }
  };

  // Bulk Actions
  const handleBulkRestore = async () => {
    if (!await showConfirm('Restore Selected', `Are you sure you want to restore ${selectedIds.size} selected item(s)?`)) return;
    try {
      const res = await fetch(`/api/admin/trash/bulk-restore/${activeTab}`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      });
      if (res.ok) {
        showToastMsg(`${selectedIds.size} items restored successfully`);
        fetchTrashItems();
      }
    } catch (err) {
      console.error('Error in bulk restore:', err);
    }
  };

  const handleBulkDelete = async () => {
    const selectedArray = Array.from(selectedIds);
    // Find some sample names for the prompt
    const sampleItems = filteredItems.filter(i => selectedArray.includes(i.id)).slice(0, 2);
    const sampleNames = sampleItems.map(i => renderItemContent(i)).join(', ');
    const moreText = selectedIds.size > 2 ? `... and ${selectedIds.size - 2} more` : '';
    
    if (!await showConfirm(
      'Delete Forever Selected', 
      `This will permanently delete ${selectedIds.size} item(s): ${sampleNames} ${moreText}. This cannot be undone.`, 
      'danger'
    )) return;

    try {
      const res = await fetch(`/api/admin/trash/bulk-permanent/${activeTab}`, {
        method: 'DELETE',
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ ids: selectedArray })
      });
      if (res.ok) {
        showToastMsg(`${selectedIds.size} items permanently deleted`);
        fetchTrashItems();
      }
    } catch (err) {
      console.error('Error in bulk delete:', err);
    }
  };

  // Helpers
  const renderItemContent = (item, isTextOnly = false) => {
    if (activeTab === 'dashboard') return item.entity_label;
    
    switch (activeTab) {
      case 'students':
      case 'leads':
      case 'teachers':
        return `${item.first_name || ''} ${item.last_name || ''} (${item.email})`;
      case 'batches':
        return `${item.batch_name} (Batch ${item.batch_number})`;
      case 'announcements':
      case 'broadcasts':
      case 'materials':
      case 'projects':
        return item.title || 'Untitled';
      case 'posts': {
        const textContent = item.content ? (item.content.substring(0, 50) + (item.content.length > 50 ? '...' : '')) : 'No Content';
        if (isTextOnly) return textContent;
        
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {item.image_url && (
              <img 
                src={getImageUrl(item.image_url)} 
                alt="Post Attachment" 
                style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '4px', cursor: 'pointer' }}
                onClick={() => setPreviewImage(getImageUrl(item.image_url))}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            )}
            <span>{textContent}</span>
          </div>
        );
      }
      default:
        return 'Unknown item';
    }
  };

  const getFilteredItems = () => {
    return items.filter(item => {
      // 1. Search Query
      if (searchQuery) {
        const label = String(renderItemContent(item, true)).toLowerCase();
        // Include action search for audit log
        const actionText = (item.action || '').toLowerCase();
        if (!label.includes(searchQuery.toLowerCase()) && !actionText.includes(searchQuery.toLowerCase())) return false;
      }
      
      // 2. Date Range
      const dateStr = activeTab === 'dashboard' ? item.performed_at : item.deleted_at;
      if (dateStr) {
        const itemDate = new Date(dateStr);
        if (startDate && itemDate < new Date(startDate)) return false;
        if (endDate) {
          const endD = new Date(endDate);
          endD.setHours(23, 59, 59, 999);
          if (itemDate > endD) return false;
        }
      }

      // 3. Deleted By (Skip if audit tab, or map to performed_by_admin_id)
      if (deletedBy) {
        if (activeTab === 'dashboard') {
          if (item.performed_by_admin_id !== parseInt(deletedBy)) return false;
        } else {
          if (item.deleted_by_admin_id !== parseInt(deletedBy)) return false;
        }
      }

      return true;
    });
  };

  const filteredItems = getFilteredItems();

  const handleToggleSelect = (id) => {
    const newSel = new Set(selectedIds);
    if (newSel.has(id)) newSel.delete(id);
    else newSel.add(id);
    setSelectedIds(newSel);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map(i => i.id)));
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setStartDate('');
    setEndDate('');
    setDeletedBy('');
  };

  const hasActiveFilters = searchQuery || startDate || endDate || deletedBy;
  const isDashboard = activeTab === 'dashboard';

  return (
    <div className="trash-manager">
      {/* TABS */}
      <div className="trash-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`trash-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* FILTERS */}
      <div className="trash-filters">
        <div className="trash-search-wrapper">
          <Search size={16} className="trash-search-icon" />
          <input
            type="text"
            placeholder={`Search ${activeTab === 'audit' ? 'Activity Log' : 'Trash'}...`}
            className="trash-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="trash-filter-group">
          <Calendar size={16} color="var(--text-secondary)" />
          <input
            type="date"
            className="trash-filter-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            title="Start Date"
          />
          <span style={{ color: 'var(--text-secondary)' }}>to</span>
          <input
            type="date"
            className="trash-filter-input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            title="End Date"
          />
        </div>

        <div className="trash-filter-group">
          <select 
            className="trash-filter-input"
            value={deletedBy}
            onChange={(e) => setDeletedBy(e.target.value)}
          >
            <option value="">All Admins</option>
            {admins.map(a => (
              <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>
            ))}
          </select>
        </div>

        {hasActiveFilters && (
          <button type="button" className="trash-btn" style={{ background: 'transparent', color: 'var(--text-secondary)' }} onClick={clearFilters}>
            <X size={16} /> Clear
          </button>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Showing {filteredItems.length} result(s)
        </span>
      </div>

      {/* BULK ACTION BAR */}
      {!isDashboard && selectedIds.size > 0 && (
        <div className="trash-action-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#60a5fa', fontWeight: 600 }}>
            <CheckSquare size={18} /> {selectedIds.size} items selected
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button type="button" className="trash-btn trash-btn-restore" onClick={handleBulkRestore}>
              <RotateCcw size={16} /> Restore Selected ({selectedIds.size})
            </button>
            <button type="button" className="trash-btn trash-btn-delete" onClick={handleBulkDelete}>
              <Trash size={16} /> Delete Forever ({selectedIds.size})
            </button>
          </div>
        </div>
      )}

      {/* LIST CONTENT */}
      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <RefreshCcw className="spinner" size={24} style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ marginTop: '1rem' }}>Loading items...</div>
        </div>
      ) : error ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: 12 }}>
          <AlertTriangle size={24} style={{ marginBottom: '1rem' }} />
          <div>{error}</div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <Trash2 size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
          <div>No items found matching the current criteria.</div>
        </div>
      ) : (
        <div className="trash-list">
          {isDashboard ? (
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid var(--glass-border)', overflow: 'hidden' }}>
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Date / Time</th>
                    <th>Admin Name</th>
                    <th>Action</th>
                    <th>Entity Type</th>
                    <th>Entity Name</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map(item => (
                    <tr key={item.id}>
                      <td>{new Date(item.performed_at).toLocaleString()}</td>
                      <td>{item.performed_by_admin_name}</td>
                      <td>
                        <span className={`trash-badge badge-${item.action.toLowerCase()}`}>
                          {item.action.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>{item.entity_type}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          {item.entity_type === 'posts' && item.original_data?.image_url && (
                            <img 
                              src={getImageUrl(item.original_data.image_url)} 
                              alt="Entity Media" 
                              style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', cursor: 'pointer' }}
                              onClick={() => setPreviewImage(getImageUrl(item.original_data.image_url))}
                              onError={(e) => { e.target.style.display = 'none'; }}
                            />
                          )}
                          <span>{item.entity_label}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              {/* Select All Checkbox Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0 1rem 0.5rem 1rem' }}>
                <button 
                  type="button" 
                  onClick={handleSelectAll}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  {selectedIds.size === filteredItems.length && filteredItems.length > 0 ? <CheckSquare size={18} color="#60a5fa" /> : <Square size={18} />}
                  <span style={{ fontSize: '0.85rem' }}>Select All</span>
                </button>
              </div>
              
              {/* Item Rows */}
              {filteredItems.map(item => (
                <div key={item.id} className="trash-item">
                  <div className="trash-item-info">
                    <button 
                      type="button" 
                      onClick={() => handleToggleSelect(item.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: selectedIds.has(item.id) ? '#60a5fa' : 'var(--text-secondary)' }}
                    >
                      {selectedIds.has(item.id) ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                    <div>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: '0.9rem' }}>
                        {renderItemContent(item)}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
                        <span>Deleted at: {new Date(item.deleted_at).toLocaleString()}</span>
                        {item.deleted_by_admin_id && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'var(--bg-tertiary)', padding: '0.1rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem' }}>
                            Deleted by: {admins.find(a => a.id === item.deleted_by_admin_id) 
                              ? `${admins.find(a => a.id === item.deleted_by_admin_id).first_name} ${admins.find(a => a.id === item.deleted_by_admin_id).last_name}` 
                              : `Admin ID: ${item.deleted_by_admin_id}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="trash-item-actions">
                    <button type="button" className="trash-btn trash-btn-restore" onClick={() => handleRestore(item.id)}>
                      <RefreshCcw size={14} /> <span className="trash-btn-text">Restore</span>
                    </button>
                    <button type="button" className="trash-btn trash-btn-delete" onClick={() => handlePermanentDelete(item.id)}>
                      <Trash2 size={14} /> <span className="trash-btn-text">Delete Forever</span>
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {toast && (
        <div className="trash-toast">
          {toast.type === 'success' ? <CheckCircle2 size={18} color="#10b981" /> : <AlertTriangle size={18} color="#ef4444" />}
          {toast.msg}
        </div>
      )}

      {/* Full Screen Image Preview Modal */}
      {previewImage && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
          onClick={() => setPreviewImage(null)}
        >
          <img 
            src={previewImage} 
            alt="Preview" 
            style={{ 
              maxWidth: '90%', 
              maxHeight: '90%', 
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
            }} 
          />
          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewImage(null);
            }}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: 'white',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          >
            <X size={24} />
          </button>
        </div>
      )}
    </div>
  );
}
