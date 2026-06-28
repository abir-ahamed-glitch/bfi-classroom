import React, { useState, useEffect } from 'react';
import { Search, Loader2, Users, Download, UserPlus, CheckCircle2, Copy, Send, X, MessageSquare } from 'lucide-react';
import * as XLSX from 'xlsx';
import BulkSmsModal from './BulkSmsModal';

export default function LeadsTable({ refreshTrigger }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  // Admit Modal State
  const [admitModalOpen, setAdmitModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [admitLoading, setAdmitLoading] = useState(false);
  const [admitError, setAdmitError] = useState('');
  
  const [batchNumber, setBatchNumber] = useState('');
  const [snNo, setSnNo] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  
  // Success Modal State
  const [successData, setSuccessData] = useState(null);
  const [admittedEmails, setAdmittedEmails] = useState(new Set());

  // SMS State
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [smsModalOpen, setSmsModalOpen] = useState(false);

  useEffect(() => {
    fetchLeads();
    fetchAdmittedStudents();
  }, [refreshTrigger]);

  const fetchLeads = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/admin/students/leads', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (!res.ok) throw new Error('Failed to fetch leads');
      const data = await res.json();
      setLeads(data);
    } catch (err) {
      console.error(err);
      setError('Could not load registered students. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAdmittedStudents = async () => {
    try {
      const res = await fetch('/api/admin/students', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        const admitted = new Set(
          (data.students || [])
            .filter(s => s.batch_number && s.batch_number.trim() !== '')
            .map(s => s.email.toLowerCase().trim())
        );
        setAdmittedEmails(admitted);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const exportToExcel = () => {
    const exportData = registeredLeads.map(l => ({
      'Full Name': l.full_name || '',
      'Email': l.email || '',
      'Mobile Number': l.mobile_number || '',
      'WhatsApp Number': l.whatsapp_number || '',
      'Gender': l.gender || '',
      'Date of Birth': l.birthday || '',
      'Present Address': l.present_address || '',
      'Educational Qualification': l.educational_qualification || '',
      'Profession': l.profession || '',
      'Registered Date': l.created_at ? new Date(l.created_at).toLocaleDateString() : ''
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, "Registered Students");
    XLSX.writeFile(wb, `BFI_Registered_Students_${new Date().toLocaleDateString().replace(/\//g, '-')}.xlsx`);
  };

  const registeredLeads = leads.filter(lead => {
    if (lead.batch_number && lead.batch_number.trim() !== '') return false;
    if (lead.email && admittedEmails.has(lead.email.toLowerCase().trim())) return false;
    return true;
  });

  const filteredLeads = registeredLeads.filter(lead => {
    const term = search.toLowerCase();
    return (
      (lead.full_name || '').toLowerCase().includes(term) ||
      (lead.email || '').toLowerCase().includes(term) ||
      (lead.mobile_number || '').toLowerCase().includes(term)
    );
  });

  // ── Checkbox helpers ──────────────────────────────────────────────────────
  const allFilteredSelected = filteredLeads.length > 0 && filteredLeads.every(l => selectedIds.has(l.user_id));
  const someSelected = filteredLeads.some(l => selectedIds.has(l.user_id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredLeads.forEach(l => next.delete(l.user_id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredLeads.forEach(l => next.add(l.user_id));
        return next;
      });
    }
  };

  const toggleSelectOne = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build SMS recipients from selected rows
  const smsRecipients = filteredLeads
    .filter(l => selectedIds.has(l.user_id))
    .map(l => ({ name: l.full_name || '', phone: l.mobile_number || '' }));

  const handleAdmitClick = (lead) => {
    setSelectedLead(lead);
    setBatchNumber('');
    setSnNo('');
    setMonth('');
    setYear(new Date().getFullYear().toString());
    setAdmitError('');
    setAdmitModalOpen(true);
  };

  const submitAdmit = async () => {
    if (!batchNumber || !snNo || !year) {
      setAdmitError('Batch Number, SN No, and Year are required.');
      return;
    }
    
    setAdmitLoading(true);
    setAdmitError('');
    
    try {
      const res = await fetch(`/api/admin/students/leads/${selectedLead.user_id}/admit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ batchNumber, snNo, month, year })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to admit student');
      
      setAdmitModalOpen(false);
      // Optimistically remove the admitted student from the list immediately
      setLeads(prev => prev.filter(l => l.user_id !== selectedLead.user_id));
      setSuccessData(data.credentials);
      fetchLeads(); // re-fetch in background to confirm server state

      fetchAdmittedStudents(); // refresh admitted set
    } catch (err) {
      setAdmitError(err.message);
    } finally {
      setAdmitLoading(false);
    }
  };

  const copyCredentials = () => {
    if (!successData) return;
    const text = `Congratulations! You have been admitted to BFI.\n\nUsername: ${successData.username}\nPassword: ${successData.password}\nStudent ID: ${successData.studentId}`;
    navigator.clipboard.writeText(text);
    alert('Credentials copied to clipboard!');
  };

  const openWhatsApp = () => {
    if (!successData || !successData.mobileNumber) {
       alert("No mobile number available for this student.");
       return;
    }
    const text = `Congratulations! You have been admitted to BFI.\n\nUsername: ${successData.username}\nPassword: ${successData.password}\nStudent ID: ${successData.studentId}\n\nPlease login to our portal.`;
    const cleanMobile = successData.mobileNumber.replace(/\D/g, '');
    window.open(`https://wa.me/${cleanMobile}?text=${encodeURIComponent(text)}`, '_blank');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
        <Loader2 className="spinner" size={24} />
        <span style={{ marginLeft: '1rem' }}>Loading registered students...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--danger)', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px' }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      {/* ── SMS Toolbar (appears when selection > 0) ──────────────────────── */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '1rem', flexWrap: 'wrap',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.12))',
          border: '1px solid rgba(99,102,241,0.35)',
          borderRadius: '12px', padding: '0.85rem 1.25rem',
          marginBottom: '1rem',
          animation: 'slideDown 0.2s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: 'white', borderRadius: '8px',
              padding: '0.3rem 0.7rem', fontWeight: 700, fontSize: '0.9rem'
            }}>
              {selectedIds.size} selected
            </div>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Ready to send SMS
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{
                background: 'transparent', border: '1px solid rgba(99,102,241,0.35)',
                color: 'var(--text-secondary)', borderRadius: '8px',
                padding: '0.45rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem'
              }}
            >
              Deselect All
            </button>
            <button
              onClick={() => setSmsModalOpen(true)}
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                border: 'none', color: 'white', borderRadius: '8px',
                padding: '0.45rem 1.1rem', cursor: 'pointer', fontWeight: 700,
                fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.45rem',
                boxShadow: '0 4px 12px rgba(99,102,241,0.4)'
              }}
            >
              <MessageSquare size={15} /> Send SMS to {selectedIds.size}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ background: 'rgba(56, 189, 248, 0.1)', color: 'var(--accent-primary)', padding: '0.5rem', borderRadius: '8px' }}>
            <Users size={20} />
          </div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Registered Students ({registeredLeads.length})
          </h3>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: '280px' }}>
            <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <Search size={16} />
            </div>
            <input 
              type="text" 
              className="input-glass"
              placeholder="Search by name, email or mobile..." 
              style={{ width: '100%', padding: '0.6rem 1rem 0.6rem 2.5rem', borderRadius: '24px', fontSize: '0.9rem' }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          
          <button onClick={exportToExcel} className="modern-btn modern-btn--secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Download size={16} /> Export
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{ width: '100%', maxWidth: '100%', minWidth: 0, maxHeight: '650px', overflowY: 'auto', overflowX: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', padding: '0', border: '1px solid var(--glass-border)', borderRadius: '12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.02)', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {/* Select-all checkbox */}
              <th style={{ padding: '1.25rem 1rem 1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', width: '40px' }}>
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  ref={el => { if (el) el.indeterminate = someSelected && !allFilteredSelected; }}
                  onChange={toggleSelectAll}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#6366f1' }}
                  title={allFilteredSelected ? 'Deselect all' : 'Select all'}
                />
              </th>
              <th style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Name</th>
              <th style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Email</th>
              <th style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Mobile</th>
              <th style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Profession</th>
              <th style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Education</th>
              <th style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Registered</th>
              <th style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600', textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  {search ? 'No students found matching your search.' : 'No registered students yet.'}
                </td>
              </tr>
            ) : (
              filteredLeads.map(lead => {
                const isChecked = selectedIds.has(lead.user_id);
                return (
                <tr 
                  key={lead.user_id}
                  className="animate-slide-up"
                  style={{ 
                    borderBottom: '1px solid var(--glass-border)', 
                    transition: 'background 0.2s',
                    background: isChecked ? 'rgba(99,102,241,0.06)' : 'transparent'
                  }} 
                  onMouseEnter={(e) => { if (!isChecked) e.currentTarget.style.background = 'rgba(14, 165, 233, 0.03)'; }} 
                  onMouseLeave={(e) => { e.currentTarget.style.background = isChecked ? 'rgba(99,102,241,0.06)' : 'transparent'; }}
                >
                  {/* Row checkbox */}
                  <td style={{ padding: '1.25rem 1rem 1.25rem 1.5rem' }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelectOne(lead.user_id)}
                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#6366f1' }}
                    />
                  </td>
                  <td style={{ padding: '1.25rem 1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1rem', flexShrink: 0 }}>
                        {lead.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{lead.full_name}</div>
                        {lead.gender && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{lead.gender}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '1.25rem 1.5rem', color: 'var(--text-secondary)' }}>{lead.email}</td>
                  <td style={{ padding: '1.25rem 1.5rem', color: 'var(--text-secondary)' }}>
                    <div>{lead.mobile_number}</div>
                    {lead.whatsapp_number && lead.whatsapp_number !== lead.mobile_number && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--accent-primary)' }}>WA: {lead.whatsapp_number}</div>
                    )}
                  </td>
                  <td style={{ padding: '1.25rem 1.5rem', color: 'var(--text-secondary)' }}>{lead.profession || '-'}</td>
                  <td style={{ padding: '1.25rem 1.5rem', color: 'var(--text-secondary)' }}>{lead.educational_qualification || '-'}</td>
                  <td style={{ padding: '1.25rem 1.5rem', color: 'var(--text-secondary)' }}>{new Date(lead.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right' }}>
                    <button 
                      onClick={() => handleAdmitClick(lead)}
                      className="btn-glass" 
                      style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', cursor: 'pointer', background: 'rgba(14, 165, 233, 0.1)', color: 'var(--accent-primary)', border: '1px solid rgba(14, 165, 233, 0.2)' }}
                    >
                      <UserPlus size={14} /> Admit
                    </button>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {admitModalOpen && selectedLead && (
        <div className="modern-modal-overlay" onClick={() => setAdmitModalOpen(false)}>
          <div className="modern-modal-content glass-panel shadow-2xl" style={{ width: '100%', maxWidth: '500px', margin: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modern-modal-header">
              <h3 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <UserPlus className="text-accent" /> Confirm Admission
              </h3>
              <button type="button" className="icon-btn-ghost" onClick={() => setAdmitModalOpen(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '60vh', minHeight: '300px', overflowY: 'auto', position: 'relative' }}>
              <p style={{ color: 'var(--text-secondary)', margin: '0 0 0.5rem 0', fontSize: '0.95rem', lineHeight: '1.5' }}>
                You are about to admit <strong style={{ color: 'var(--accent-primary)' }}>{selectedLead.full_name}</strong>. Provide batch details to generate their credentials.
              </p>

              {admitError && (
                <div style={{
                  padding: '0.65rem 1rem',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.45)',
                  borderRadius: '8px',
                  color: '#f87171',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  marginBottom: '1rem'
                }}>
                  <span style={{ flexShrink: 0 }}>⚠️</span>
                  <span>{admitError}</span>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Batch Number</label>
                  <input type="text" className="input-glass" value={batchNumber} onChange={e => setBatchNumber(e.target.value)} placeholder="e.g. 53" style={{ paddingLeft: '1rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>SN No. (2 digits)</label>
                  <input type="text" className="input-glass" value={snNo} onChange={e => setSnNo(e.target.value)} placeholder="e.g. 05" style={{ paddingLeft: '1rem' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Month (Optional)</label>
                  <input type="text" className="input-glass" value={month} onChange={e => setMonth(e.target.value)} placeholder="e.g. 05" style={{ paddingLeft: '1rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Year (4 digits)</label>
                  <input type="text" className="input-glass" value={year} onChange={e => setYear(e.target.value)} placeholder="e.g. 2026" style={{ paddingLeft: '1rem' }} />
                </div>
              </div>
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setAdmitModalOpen(false)} className="modern-btn modern-btn--secondary" style={{ flex: 1 }} disabled={admitLoading}>
                Cancel
              </button>
              <button onClick={submitAdmit} className="modern-btn modern-btn--primary" disabled={admitLoading} style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}>
                {admitLoading ? <Loader2 className="spinner" size={18} /> : 'Confirm Admission'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* SUCCESS MODAL */}
      {successData && (
        <div className="modern-modal-overlay">
          <div className="modern-modal-content glass-panel shadow-2xl" style={{ width: '100%', maxWidth: '450px', margin: 'auto' }}>
            <div className="modern-modal-body" style={{ textAlign: 'center', padding: '2.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', padding: '1rem', borderRadius: '50%' }}>
                  <CheckCircle2 size={40} />
                </div>
              </div>
              <h2 className="font-display" style={{ color: 'var(--text-primary)', margin: '0 0 0.5rem 0' }}>Student Admitted!</h2>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Credentials have been successfully generated.</p>

              <div className="academic-assignment-box" style={{ padding: '1.5rem', textAlign: 'left', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Username:</span>
                  <strong style={{ color: 'var(--accent-primary)' }}>{successData.username}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Password:</span>
                  <strong style={{ color: 'var(--accent-primary)' }}>{successData.password}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Student ID:</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{successData.studentId}</strong>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexDirection: 'column' }}>
                <button onClick={copyCredentials} className="modern-btn modern-btn--primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%' }}>
                  <Copy size={16} /> Copy Credentials
                </button>
                
                <button onClick={openWhatsApp} className="modern-btn" style={{ background: '#25D366', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%' }}>
                  <Send size={16} /> Send via WhatsApp
                </button>
                
                <button onClick={() => setSuccessData(null)} className="modern-btn modern-btn--secondary" style={{ width: '100%' }}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk SMS Modal ──────────────────────────────────────────────────── */}
      {smsModalOpen && smsRecipients.length > 0 && (
        <BulkSmsModal
          recipients={smsRecipients}
          onClose={() => setSmsModalOpen(false)}
        />
      )}
    </div>
  );
}
