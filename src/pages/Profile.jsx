import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  User, Mail, Phone, MapPin, Calendar, CheckSquare, 
  Lock, AlertCircle, Save, CheckCircle2, Link2, Plus, X,
  Award, BookOpen, Film, Download, CheckCircle, Briefcase
} from 'lucide-react';

export default function Profile() {
  const { currentUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [socialLinks, setSocialLinks] = useState([]);
  const [experiences, setExperiences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Editable fields
  const [formData, setFormData] = useState({
    gender: '',
    birthday: '',
    present_address: '',
    permanent_address: '',
    mobile_number: '',
    whatsapp_number: '',
    bio: ''
  });

  const availableSocialPlatforms = ['Facebook', 'YouTube', 'Vimeo', 'LinkedIn', 'Instagram', 'Twitter / X', 'Website', 'Other'];

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/student/profile', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        setFormData({
          gender: data.gender || '',
          birthday: data.birthday || '',
          present_address: data.present_address || '',
          permanent_address: data.permanent_address || '',
          mobile_number: data.mobile_number || '',
          whatsapp_number: data.whatsapp_number || '',
          bio: data.bio || ''
        });
        setSocialLinks(data.socialLinks || []);
        setExperiences(data.experiences || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const addSocialLink = () => {
    setSocialLinks([...socialLinks, { platform: 'Facebook', url: '' }]);
  };

  const updateSocialLink = (index, field, value) => {
    const updated = [...socialLinks];
    updated[index][field] = value;
    setSocialLinks(updated);
  };

  const removeSocialLink = (index) => {
    const updated = [...socialLinks];
    updated.splice(index, 1);
    setSocialLinks(updated);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    
    try {
      const payload = {
        ...formData,
        socialLinks
      };

      const res = await fetch('/api/student/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        setMessage('Profile updated successfully!');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => setMessage(''), 5000);
      } else {
        throw new Error('Failed to update profile');
      }
    } catch (err) {
      console.error(err);
      setMessage('Error updating profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-container container"><h2 className="text-secondary">Loading Profile...</h2></div>;

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem', maxWidth: '1000px' }}>
      
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2rem', marginBottom: '3rem' }}>
        <div style={{ position: 'relative' }}>
          <div style={{ width: '120px', height: '120px', borderRadius: '50%', background: 'var(--bg-gradient-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', fontWeight: 'bold' }}>
            {profile?.first_name?.[0] || 'U'}
          </div>
          <button style={{ position: 'absolute', bottom: 0, right: 0, background: 'var(--bg-secondary)', border: '1px solid var(--glass-border)', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}>
            <User size={18} />
          </button>
        </div>
        <div>
          <h1 className="font-display" style={{ fontSize: '2.5rem', margin: 0 }}>{profile?.full_name}</h1>
          <p className="text-muted" style={{ fontSize: '1.1rem', marginTop: '0.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span>{profile?.student_id}</span>
            <span style={{ width: '4px', height: '4px', background: 'var(--text-muted)', borderRadius: '50%' }}></span>
            <span>Batch: {profile?.batch_number}</span>
          </p>
        </div>
      </div>

      {message && (
        <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', color: '#34d399', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CheckCircle2 size={18} /> {message}
        </div>
      )}

      {/* Live Course Progression Tracker */}
      <section className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', border: '1px solid var(--accent-primary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Award size={20} className="text-accent" /> Live Course Progression
          </h3>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {profile?.enrollments && profile.enrollments.map(course => (
            <div key={course.id} style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, color: 'var(--text-secondary)' }}>
                  {course.course_type === 'filmmaking' ? <Film size={18} /> : <BookOpen size={18} />}
                  {course.course_name}
                </h4>
                {course.step4_completed === 1 && (
                  <button className="btn btn-primary" onClick={() => alert(`Certificate for ${course.course_name} Coming Soon`)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
                    <Download size={14} /> Download Certificate
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                {course.course_type === 'filmmaking' ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step1_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step1_completed ? '#34d399' : 'transparent', border: course.step1_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step1_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Phase 1: Enrolled</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step2_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step2_completed ? '#34d399' : 'transparent', border: course.step2_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step2_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Phase 1: Passed Exam</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step3_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step3_completed ? '#34d399' : 'transparent', border: course.step3_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step3_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Phase 2: Enrolled</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step4_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step4_completed ? '#34d399' : 'transparent', border: course.step4_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step4_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Phase 2: Completed</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step1_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step1_completed ? '#34d399' : 'transparent', border: course.step1_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step1_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Admission Confirmed</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: course.step4_completed ? 1 : 0.5 }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: course.step4_completed ? '#34d399' : 'transparent', border: course.step4_completed ? 'none' : '2px solid var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {course.step4_completed ? <CheckCircle size={16} color="black" /> : null}
                      </div>
                      <div className="text-sm">Course Completed</div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
          {(!profile?.enrollments || profile.enrollments.length === 0) && (
            <p className="text-muted" style={{ fontStyle: 'italic' }}>No active course enrollments found.</p>
          )}
        </div>
      </section>

      <form onSubmit={handleSave}>
        
        {/* Core Institutional Info (Non-editable) */}
        <section className="glass-panel institutional-section" style={{ padding: '2rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
              <Lock size={18} /> Institutional Records
            </h3>
            <span className="badge-pill">Verified by BFI Authority</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
            <div className="input-group locked" title="Please contact the institute">
              <label>Full Name (Certificate Name) <AlertCircle size={14} className="text-accent" style={{ verticalAlign: 'middle', marginLeft: '4px' }}/></label>
              <div className="locked-input-container">
                <input type="text" className="input-glass" readOnly value={profile?.full_name || ''} disabled style={{ cursor: 'not-allowed' }} />
                <Lock size={14} className="lock-icon" />
              </div>
            </div>
            <div className="input-group locked" title="Please contact the institute">
              <label>Student Batch <AlertCircle size={14} className="text-accent" style={{ verticalAlign: 'middle', marginLeft: '4px' }}/></label>
              <div className="locked-input-container">
                <input type="text" className="input-glass" readOnly value={profile?.batch_number || ''} disabled style={{ cursor: 'not-allowed' }} />
                <Lock size={14} className="lock-icon" />
              </div>
            </div>
            <div className="input-group locked" title="Please contact the institute">
              <label>Email Address <AlertCircle size={14} className="text-accent" style={{ verticalAlign: 'middle', marginLeft: '4px' }}/></label>
              <div className="locked-input-container">
                <input type="text" className="input-glass" readOnly value={profile?.email || ''} disabled style={{ cursor: 'not-allowed' }} />
                <Lock size={14} className="lock-icon" />
              </div>
            </div>
          </div>
          <p style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', padding: '0.8rem', borderRadius: '8px', borderLeft: '3px solid var(--accent-primary)' }}>
            <strong>Note:</strong> These fields are institutional records linked to your official certificate. If there is a typo or error, please submit a request to the BFI Administration.
          </p>
        </section>

        {/* Personal Details */}
        <section className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
          <h3 className="font-display" style={{ marginBottom: '1.5rem' }}>Personal Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
            <div className="input-group">
              <label>Gender</label>
              <select name="gender" value={formData.gender} onChange={handleChange} className="input-glass" style={{ appearance: 'none' }}>
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </div>
            <div className="input-group">
              <label>Birthday</label>
              <input type="date" name="birthday" value={formData.birthday} onChange={handleChange} className="input-glass" />
            </div>
            <div className="input-group">
              <label>Present Address</label>
              <input type="text" name="present_address" value={formData.present_address} onChange={handleChange} className="input-glass" placeholder="Current living address" />
            </div>
            <div className="input-group">
              <label>Permanent Address</label>
              <input type="text" name="permanent_address" value={formData.permanent_address} onChange={handleChange} className="input-glass" placeholder="Permanent home address" />
            </div>
          </div>
        </section>

        {/* Contact info */}
        <section className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
          <h3 className="font-display" style={{ marginBottom: '1.5rem' }}>Contact Information</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
            <div className="input-group">
              <label>Mobile Number</label>
              <div className="input-wrapper">
                <Phone size={18} className="input-icon" />
                <input type="tel" name="mobile_number" value={formData.mobile_number} onChange={handleChange} className="input-glass" placeholder="+880..." />
              </div>
            </div>
            <div className="input-group">
              <label>WhatsApp Number</label>
              <div className="input-wrapper">
                <Phone size={18} className="input-icon" />
                <input type="tel" name="whatsapp_number" value={formData.whatsapp_number} onChange={handleChange} className="input-glass" placeholder="+880..." />
              </div>
            </div>
          </div>

          <div style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <label>Social Media Links</label>
              <button type="button" onClick={addSocialLink} className="btn btn-glass" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                <Plus size={16} /> Add Link
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {socialLinks.map((link, index) => (
                <div key={index} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <select 
                    value={link.platform} 
                    onChange={(e) => updateSocialLink(index, 'platform', e.target.value)} 
                    className="input-glass" 
                    style={{ flex: '1', maxWidth: '200px', appearance: 'none' }}
                  >
                    {availableSocialPlatforms.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <div className="input-wrapper" style={{ flex: '3' }}>
                    <Link2 size={16} className="input-icon" />
                    <input 
                      type="url" 
                      value={link.url} 
                      onChange={(e) => updateSocialLink(index, 'url', e.target.value)} 
                      className="input-glass" 
                      placeholder="https://..." 
                      style={{ width: '100%' }}
                    />
                  </div>
                  <button type="button" onClick={() => removeSocialLink(index)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }}>
                    <X size={20} />
                  </button>
                </div>
              ))}
              {socialLinks.length === 0 && <p className="text-muted" style={{ fontSize: '0.9rem', fontStyle: 'italic' }}>No social media links added yet.</p>}
            </div>
          </div>
        </section>

        {/* Bio */}
        <section className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
          <h3 className="font-display" style={{ marginBottom: '1.5rem' }}>About Me (Bio)</h3>
          <textarea 
            name="bio" 
            value={formData.bio} 
            onChange={handleChange} 
            className="input-glass" 
            placeholder="Tell the community about your filmmaking interests..." 
            style={{ minHeight: '120px', padding: '1rem', resize: 'vertical', width: '100%' }}
          />
        </section>

        {/* Experience Section (Read-only view in profile) */}
        <section className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Briefcase size={20} className="text-secondary" /> Work & Cultural Experience
            </h3>
            <NavLink to="/experience" className="btn btn-glass" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}>
              Edit Experiences
            </NavLink>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {experiences.map((exp, idx) => (
              <div key={idx} style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', borderLeft: '3px solid var(--accent-primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <h4 style={{ margin: 0, fontSize: '1.1rem' }}>{exp.title}</h4>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{exp.start_date} - {exp.end_date || 'Present'}</span>
                </div>
                <p style={{ margin: '0.2rem 0', color: 'var(--accent-primary)', fontSize: '0.9rem', fontWeight: 500 }}>{exp.organization}</p>
                {exp.description && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.5rem 0 0 0' }}>{exp.description}</p>}
              </div>
            ))}
            {experiences.length === 0 && (
              <p className="text-muted" style={{ fontStyle: 'italic', fontSize: '0.9rem' }}>No experiences added to profile yet.</p>
            )}
          </div>
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2rem' }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Save size={18} /> {saving ? 'Saving Changes...' : 'Save Profile Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
