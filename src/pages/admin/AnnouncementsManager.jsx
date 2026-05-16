import { useState, useEffect } from 'react';
import { Megaphone, Trash2, Send, AlertTriangle } from 'lucide-react';


export default function AnnouncementsManager() {
  const [announcements, setAnnouncements] = useState([]);
  const [courseOptions, setCourseOptions] = useState([]);
  const [courseBatchesMap, setCourseBatchesMap] = useState({});
  const [loading, setLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    priority: 'normal',
    targetCourse: '',
    targetBatch: ''
  });

  useEffect(() => {
    fetchAnnouncements();
    fetchOptions();
  }, []);

  const fetchOptions = async () => {
    if (window.location.hostname.includes('github.io')) {
      setCourseOptions(['Online Filmmaking Course', 'Film Appreciation Course']);
      setCourseBatchesMap({
        'Online Filmmaking Course': ['75', '76'],
        'Film Appreciation Course': ['2023', '2024']
      });
      return;
    }
    try {
      const res = await fetch('/api/admin/targeting-options?_t=' + Date.now(), {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        
        const sortBatches = (a, b) => {
          const numA = parseInt(a, 10);
          const numB = parseInt(b, 10);
          if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
          return String(a).localeCompare(String(b));
        };
        
        const sortedCourseBatches = {};
        if (data.courseBatches) {
          for (const course in data.courseBatches) {
            sortedCourseBatches[course] = [...data.courseBatches[course]].sort(sortBatches);
          }
        }

        setCourseOptions(data.courses || []);
        setCourseBatchesMap(sortedCourseBatches);
      }
    } catch (err) {
      console.error('Fetch targeting options error', err);
    }
  };

  const fetchAnnouncements = async () => {
    if (window.location.hostname.includes('github.io')) {
      setAnnouncements([
        { id: 1, title: 'Welcome to the BFI Classroom Demo', content: 'You are currently viewing the static preview. Since GitHub Pages is a static host, we have enabled "Demo Mode" with mocked data so you can explore the interface.', priority: 'high', admin_name: 'Admin', created_at: new Date() },
        { id: 2, title: 'Summer Batch Admissions Open', content: 'Admissions are now open for the 76th Batch of Online Filmmaking.', priority: 'normal', admin_name: 'Admin', created_at: new Date(Date.now() - 86400000) }
      ]);
      return;
    }
    try {
      const res = await fetch('/api/admin/announcements', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data.announcements || []);
      }
    } catch (err) {
      console.error('Fetch announcements error', err);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setFormData({ title: '', content: '', priority: 'normal', targetCourse: '', targetBatch: '' });
        fetchAnnouncements();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      console.error('Create error', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this announcement?")) return;
    try {
      const res = await fetch(`/api/admin/announcements/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) fetchAnnouncements();
    } catch (err) {
      console.error('Delete error', err);
    }
  };

  return (
    <div className="page-container container">
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Announcements</h1>
        <p className="subtitle">Broadcast important news and alerts to all students.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>
        <div className="glass-panel" style={{ padding: '2rem', alignSelf: 'start' }}>
          <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Megaphone className="text-accent" /> New Broadcast
          </h2>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Title</label>
              <input type="text" className="input-glass" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Message Content</label>
              <textarea className="input-glass" required rows="4" value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} style={{ resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Priority</label>
              <select className="input-glass" value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})}>
                <option value="low">Low (Info)</option>
                <option value="normal">Normal (Standard Alert)</option>
                <option value="high">High (Urgent Warning)</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Target Course (Optional)</label>
                <select className="input-glass" value={formData.targetCourse} onChange={e => setFormData({...formData, targetCourse: e.target.value, targetBatch: ''})}>
                  <option value="">All Courses (Global)</option>
                  {courseOptions.map((c, i) => <option key={i} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Target Batch (Optional)</label>
                <select 
                  className="input-glass" 
                  value={formData.targetBatch} 
                  onChange={e => setFormData({...formData, targetBatch: e.target.value})}
                  disabled={!formData.targetCourse}
                  style={{ 
                    cursor: !formData.targetCourse ? 'not-allowed' : 'pointer',
                    opacity: !formData.targetCourse ? 0.6 : 1
                  }}
                >
                  <option value="">All Batches</option>
                  {formData.targetCourse && courseBatchesMap[formData.targetCourse] && 
                    courseBatchesMap[formData.targetCourse].map((b, i) => <option key={i} value={b}>Batch {b}</option>)}
                </select>
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '1rem' }}>
              <Send size={18} /> {loading ? 'Broadcasting...' : 'Send Announcement'}
            </button>
          </form>
        </div>

        <div>
          <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle className="text-secondary" /> Recent Broadcasts
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {announcements.map(a => (
              <div key={a.id} className="glass-panel" style={{ padding: '1.5rem', position: 'relative', borderLeft: a.priority === 'high' ? '4px solid var(--danger)' : a.priority === 'normal' ? '4px solid var(--warning)' : '4px solid var(--success)' }}>
                <button onClick={() => handleDelete(a.id)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <Trash2 size={18} className="card-hover" />
                </button>
                <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', marginRight: '2rem' }}>{a.title}</h3>
                {(a.target_course || a.target_batch) && (
                  <div style={{ marginBottom: '0.8rem', display: 'flex', gap: '0.5rem' }}>
                    {a.target_course && <span style={{ background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', color: 'var(--text-primary)' }}>Course: {a.target_course}</span>}
                    {a.target_batch && <span style={{ background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', color: 'var(--text-primary)' }}>Batch: {a.target_batch}</span>}
                  </div>
                )}
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '1rem', whiteSpace: 'pre-wrap' }}>{a.content}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <span>By {a.admin_name}</span>
                  <span>{new Date(a.created_at).toLocaleString()}</span>
                </div>
              </div>
            ))}
            {announcements.length === 0 && (
              <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No active announcements found.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
