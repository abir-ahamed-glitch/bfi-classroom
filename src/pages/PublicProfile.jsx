import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { resolveMediaUrl } from '../utils/mediaUtils';
import { useAuth } from '../context/AuthContext';
import { getOrdinalSuffix } from '../utils/formatUtils';
import {
  User, Mail, Phone, MapPin, Calendar, Briefcase, Award,
  FolderGit2, MessageSquare, ArrowLeft, Info, Link as LinkIcon, Play, Video
} from 'lucide-react';

export default function PublicProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playingProjectId, setPlayingProjectId] = useState(null);
  const [brokenThumbs, setBrokenThumbs] = useState({});

  const getEmbedUrl = (url, source) => {
    if (!url) return '';
    try {
      if (source === 'youtube' || !source) {
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
        return match ? `https://www.youtube.com/embed/${match[1]}?autoplay=1&controls=1&origin=${window.location.origin}` : url;
      }
      if (source === 'vimeo') {
        const match = url.match(/vimeo\.com\/(?:[a-z]*\/)*([0-9]{6,11})[?]?.*/);
        return match ? `https://player.vimeo.com/video/${match[1]}?autoplay=1` : url;
      }
      if (source === 'facebook') {
        return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0&width=560&autoplay=true`;
      }
    } catch { /* ignore */ }
    return url;
  };

  const getYoutubeThumbnail = (url) => {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
    if (!match) return null;
    const id = match[1];
    const rawUrl = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    const API_BASE = import.meta.env.VITE_API_URL || '';
    return `${API_BASE}/api/proxy-image?url=${encodeURIComponent(rawUrl)}`;
  };

  const getProjectPoster = (proj) => {
    if (brokenThumbs[proj.id]) return null;
    if (proj.thumbnail_url) return resolveMediaUrl(proj.thumbnail_url);
    if (proj.poster_url) return resolveMediaUrl(proj.poster_url);
    return getYoutubeThumbnail(proj.media_link) || null;
  };

  const fetchProfile = useCallback(async (showLoader = true) => {
    if (!id) return;
    try {
      if (showLoader) setLoading(true);
      const res = await fetch(`/api/student/profile/${id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (!res.ok) {
        throw new Error('Failed to load profile');
      }
      
      const data = await res.json();
      setProfile(data);
    } catch (err) {
      console.error(err);
      if (showLoader) setError('User profile not found or unavailable.');
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    
    // Redirect to own profile if trying to view oneself
    if (Number(id) === Number(currentUser?.id)) {
      navigate('/profile', { replace: true });
      return;
    }

    fetchProfile(true);
  }, [id, currentUser, navigate, fetchProfile]);

  // Re-fetch profile silently when tab regains focus (picks up edits made by the profile owner)
  useEffect(() => {
    if (!id) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchProfile(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [id, fetchProfile]);

  const handleMessageClick = () => {
    if (!profile) return;
    navigate('/inbox', {
      state: {
        selectedUser: {
          id: profile.id,
          first_name: profile.first_name,
          last_name: profile.last_name,
          role: profile.role,
          profile_picture: profile.profile_picture
        }
      }
    });
  };

  if (loading) {
    return (
      <div className="page-container container" style={{ padding: '2rem' }}>
        <h2 className="text-secondary">Loading Profile...</h2>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="page-container container" style={{ padding: '2rem' }}>
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
          <h3 className="text-accent">{error || 'Profile not found'}</h3>
          <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ marginTop: '1rem' }}>
            <ArrowLeft size={16} /> Go Back
          </button>
        </div>
      </div>
    );
  }

  const {
    role, first_name, last_name, full_name, profile_picture, bio, gender,
    batch_number, educational_qualification, profession,
    email, mobile_number, whatsapp_number,
    birthday, present_address, permanent_address,
    socialLinks, experiences, portfolio
  } = profile;

  const displayName = full_name || `${first_name || ''} ${last_name || ''}`.trim();
  const isFullAccess = currentUser?.role === 'admin' || currentUser?.role === 'instructor';
  
  const getAvatarUrl = () => {
    if (profile_picture) return resolveMediaUrl(profile_picture);
    const g = gender === 'Female' ? 'female' : 'male';
    if (role === 'instructor' || role === 'admin') {
      return resolveMediaUrl(`avatars/teacher_${g}.png`);
    }
    return resolveMediaUrl(`avatars/${g}1.png`);
  };

  const getRoleDisplay = () => {
    if (role === 'admin') return 'Administrator';
    if (role === 'instructor') return 'Teacher';
    if (role === 'student') return batch_number ? `Student - ${getOrdinalSuffix(batch_number)} Batch` : 'Student';
    return role;
  };

  return (
    <div className="page-container container" style={{ paddingBottom: '4rem', maxWidth: '800px', margin: '0 auto' }}>
      
      <button 
        className="btn" 
        onClick={() => navigate(-1)} 
        style={{ marginBottom: '1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)' }}
      >
        <ArrowLeft size={16} /> Back
      </button>

      {/* Header Profile Card */}
      <section className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', alignItems: 'center' }}>
          <div style={{
            width: '120px', height: '120px', borderRadius: '50%',
            border: '3px solid var(--accent-primary)', overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)', flexShrink: 0
          }}>
            <img src={getAvatarUrl()} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 className="font-display" style={{ margin: '0 0 0.5rem 0', fontSize: '2.2rem' }}>{displayName}</h1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem', alignItems: 'flex-start' }}>
              <span className="badge-pill" style={{ background: 'var(--accent-primary)', color: 'white' }}>
                {getRoleDisplay()}
              </span>
              {profile?.role === 'instructor' && profile?.subjects && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {JSON.parse(profile.subjects).map((sub, i) => (
                    <span key={i} className="badge-pill" style={{ background: 'rgba(255,255,255,0.1)', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.2)' }}>
                      {sub}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {bio && <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.5, margin: 0 }}>{bio}</p>}
          </div>
          <div style={{ alignSelf: 'flex-start' }}>
            <button className="btn btn-primary" onClick={handleMessageClick} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <MessageSquare size={16} /> Message
            </button>
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        
        {/* Core Details */}
        <section className="glass-panel" style={{ padding: '1.5rem' }}>
          <h3 className="font-display" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem' }}>
            <User size={18} className="text-accent" /> Profile Info
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            {educational_qualification && (
              <div style={{ display: 'flex', gap: '0.8rem', color: 'var(--text-secondary)' }}>
                <Award size={16} style={{ marginTop: '2px', color: 'var(--text-muted)' }} />
                <div><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Education</span>{educational_qualification}</div>
              </div>
            )}
            {profession && (
              <div style={{ display: 'flex', gap: '0.8rem', color: 'var(--text-secondary)' }}>
                <Briefcase size={16} style={{ marginTop: '2px', color: 'var(--text-muted)' }} />
                <div><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Profession</span>{profession}</div>
              </div>
            )}
            {isFullAccess && gender && (
              <div style={{ display: 'flex', gap: '0.8rem', color: 'var(--text-secondary)' }}>
                <Info size={16} style={{ marginTop: '2px', color: 'var(--text-muted)' }} />
                <div><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Gender</span>{gender}</div>
              </div>
            )}
            {isFullAccess && birthday && (
              <div style={{ display: 'flex', gap: '0.8rem', color: 'var(--text-secondary)' }}>
                <Calendar size={16} style={{ marginTop: '2px', color: 'var(--text-muted)' }} />
                <div><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Birthday</span>{new Date(birthday).toLocaleDateString()}</div>
              </div>
            )}
          </div>
        </section>

        {/* Contact Info */}
        {(email || mobile_number || whatsapp_number || isFullAccess) && (
          <section className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 className="font-display" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem' }}>
              <Phone size={18} className="text-accent" /> Contact & Location
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              {email && (
                <div style={{ display: 'flex', gap: '0.8rem', color: 'var(--text-secondary)' }}>
                  <Mail size={16} style={{ marginTop: '2px', color: 'var(--text-muted)' }} />
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Email</span>{email}</div>
                </div>
              )}
              {mobile_number && (
                <div style={{ display: 'flex', gap: '0.8rem', color: 'var(--text-secondary)' }}>
                  <Phone size={16} style={{ marginTop: '2px', color: 'var(--text-muted)' }} />
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Mobile</span>{mobile_number}</div>
                </div>
              )}
              {whatsapp_number && (
                <div style={{ display: 'flex', gap: '0.8rem', color: 'var(--text-secondary)' }}>
                  <MessageSquare size={16} style={{ marginTop: '2px', color: '#25D366' }} />
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>WhatsApp</span>{whatsapp_number}</div>
                </div>
              )}
              {isFullAccess && present_address && (
                <div style={{ display: 'flex', gap: '0.8rem', color: 'var(--text-secondary)' }}>
                  <MapPin size={16} style={{ marginTop: '2px', color: 'var(--text-muted)' }} />
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Present Address</span>{present_address}</div>
                </div>
              )}
              {isFullAccess && permanent_address && (
                <div style={{ display: 'flex', gap: '0.8rem', color: 'var(--text-secondary)' }}>
                  <MapPin size={16} style={{ marginTop: '2px', color: 'var(--text-muted)' }} />
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Permanent Address</span>{permanent_address}</div>
                </div>
              )}
            </div>
          </section>
        )}

      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
        
        {/* Social Links */}
        {socialLinks && socialLinks.length > 0 && (
          <section className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 className="font-display" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem' }}>
              <LinkIcon size={18} className="text-accent" /> Social Links
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {socialLinks.map(link => (
                <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" 
                   style={{ padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '20px', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {link.platform}
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Portfolio Overview */}
        {portfolio && portfolio.length > 0 && (
          <section style={{ gridColumn: '1 / -1' }}>
            <h3 className="font-display" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.4rem' }}>
              <FolderGit2 size={22} className="text-accent" /> Public Portfolio
            </h3>
            <div className="public-portfolio-grid">
              {portfolio.map(proj => (
                <div key={proj.id} className="portfolio-card glass-panel">
                  <div className="card-media">
                    {proj.awards && proj.awards.length > 0 && <div className="achievement-badge"><Award size={16} /></div>}
                    
                    {proj.media_link ? (
                      <div className="video-wrapper">
                        {playingProjectId === proj.id ? (
                          <iframe 
                            src={getEmbedUrl(proj.media_link, proj.media_source)} 
                            frameBorder="0" 
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                            referrerPolicy="strict-origin-when-cross-origin"
                            allowFullScreen
                          />
                        ) : (
                          <div className="video-thumbnail-placeholder" onClick={() => setPlayingProjectId(proj.id)}>
                            {getProjectPoster(proj) ? (
                              <img 
                                src={getProjectPoster(proj)} 
                                alt={proj.title} 
                                onError={() => setBrokenThumbs(prev => ({...prev, [proj.id]: true}))}
                              />
                            ) : (
                              <div className="placeholder-overlay">
                                <Video size={48} opacity={0.3} />
                              </div>
                            )}
                            <div className="play-overlay">
                              <Play size={48} fill="white" />
                            </div>
                          </div>
                        )}
                      </div>
                    ) : getProjectPoster(proj) ? (
                      <div className="poster-wrapper">
                        <img 
                          src={getProjectPoster(proj)} 
                          alt={proj.title}
                          onError={() => setBrokenThumbs(prev => ({...prev, [proj.id]: true}))}
                        />
                      </div>
                    ) : (
                      <div className="placeholder-wrapper">
                        <Video size={48} opacity={0.3} />
                      </div>
                    )}
                  </div>

                  <div className="card-details">
                    <div className="title-row">
                      <h3 className="font-display">{proj.title}</h3>
                      {proj.duration && <span className="duration">{proj.duration}</span>}
                    </div>
                    
                    {proj.synopsis && <p className="synopsis">{proj.synopsis}</p>}
                    
                    {proj.credits && proj.credits.length > 0 && (
                      <div className="metadata">
                        {proj.credits.slice(0, 3).map((c, i) => (
                          <span key={i} className="credit-pill"><strong>{c.role}:</strong> {c.name}</span>
                        ))}
                        {proj.credits.length > 3 && <span className="credit-pill">+{proj.credits.length - 3} more</span>}
                      </div>
                    )}

                    {proj.awards && proj.awards.length > 0 && (
                      <div className="card-awards">
                        <Award size={14} className="text-warning" /> 
                        <span>{proj.awards.length} Award{proj.awards.length > 1 ? 's' : ''}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Experience Section */}
      {experiences && experiences.length > 0 && (
        <section className="glass-panel" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
          <h3 className="font-display" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem' }}>
            <Award size={18} className="text-accent" /> Experience & Achievements
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {experiences.map(exp => (
              <div key={exp.id} style={{ padding: '1rem', borderLeft: '3px solid var(--accent-primary)', background: 'rgba(255,255,255,0.02)', borderRadius: '0 8px 8px 0' }}>
                <h4 style={{ margin: '0 0 0.25rem 0' }}>{exp.title}</h4>
                {exp.organization && <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>{exp.organization}</div>}
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {exp.start_date || 'N/A'} - {exp.end_date || 'Present'}
                </div>
                {exp.description && <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.5rem', marginBottom: 0 }}>{exp.description}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <style>{`
        .public-portfolio-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 1.5rem;
        }
        .portfolio-card {
          border-radius: 12px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          border: 1px solid var(--glass-border);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .portfolio-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 25px rgba(0,0,0,0.4);
        }
        .card-media {
          position: relative;
          aspect-ratio: 16/9;
          background: #000;
          overflow: hidden;
        }
        .achievement-badge {
          position: absolute;
          top: 1rem;
          left: 1rem;
          background: linear-gradient(135deg, var(--warning) 0%, #d97706 100%);
          color: white;
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
          box-shadow: 0 4px 10px rgba(0,0,0,0.5);
        }
        .video-thumbnail-placeholder {
          position: relative;
          width: 100%;
          height: 100%;
          cursor: pointer;
          overflow: hidden;
          background: #000;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .video-thumbnail-placeholder img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.5s ease;
        }
        .video-thumbnail-placeholder:hover img {
          transform: scale(1.05);
        }
        .play-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.3s ease;
        }
        .video-thumbnail-placeholder:hover .play-overlay {
          background: rgba(0,0,0,0.5);
        }
        .play-overlay svg {
          color: white;
          filter: drop-shadow(0 0 15px rgba(239, 68, 68, 0.6));
          transition: transform 0.3s ease, filter 0.3s ease;
        }
        .video-thumbnail-placeholder:hover .play-overlay svg {
          transform: scale(1.15);
          filter: drop-shadow(0 0 20px rgba(239, 68, 68, 0.9));
        }
        .placeholder-overlay {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          background: var(--bg-surface-2);
          color: var(--text-muted);
        }
        .poster-wrapper img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .placeholder-wrapper {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-surface-2);
          color: var(--text-muted);
        }
        .video-wrapper, .video-wrapper iframe {
          width: 100%;
          height: 100%;
          border: none;
        }
        .card-details { padding: 1.5rem; display: flex; flex-direction: column; flex: 1; }
        .title-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; }
        .title-row h3 { font-size: 1.2rem; margin: 0; line-height: 1.3; }
        .duration { font-size: 0.75rem; color: var(--text-muted); background: rgba(255,255,255,0.05); padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid var(--glass-border); }
        .synopsis { font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .metadata { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
        .credit-pill { font-size: 0.75rem; padding: 0.2rem 0.6rem; background: rgba(255,255,255,0.05); border-radius: 12px; color: var(--text-secondary); }
        .credit-pill strong { color: var(--text-primary); }
        .card-awards { display: flex; alignItems: center; gap: 0.5rem; font-size: 0.8rem; color: var(--warning); margin-bottom: 0.5rem; }
      `}</style>
    </div>
  );
}
