import { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { resolveMediaUrl } from '../utils/mediaUtils';
import { getOrdinalSuffix } from '../utils/formatUtils';
import { 
  User, Mail, Phone, MapPin, Calendar, CheckSquare, 
  Lock, AlertCircle, Save, CheckCircle2, Link2, Plus, X, ChevronDown,
  Award, BookOpen, Film, Download, CheckCircle, Briefcase, Camera, Image as ImageIcon, Move,
  Pencil, ExternalLink
} from 'lucide-react';
import {
  FaBehance, FaDiscord, FaDribbble, FaFacebookF, FaGithub, FaGlobe,
  FaInstagram, FaLinkedinIn, FaMedium, FaPinterestP, FaSnapchat,
  FaTelegram, FaThreads, FaTiktok, FaVimeoV, FaWhatsapp, FaXTwitter,
  FaYoutube
} from 'react-icons/fa6';
import { FaLink } from 'react-icons/fa';

const validateSocialLink = (platform, url) => {
  if (!url || !url.trim()) return true;
  const lowerUrl = url.toLowerCase();
  const rules = {
    Facebook: ['facebook.com', 'fb.com', 'fb.watch', 'm.me'],
    YouTube: ['youtube.com', 'youtu.be'],
    Vimeo: ['vimeo.com'],
    LinkedIn: ['linkedin.com'],
    Instagram: ['instagram.com', 'instagr.am'],
    TikTok: ['tiktok.com'],
    WhatsApp: ['wa.me', 'whatsapp.com'],
    Telegram: ['t.me', 'telegram.me', 'telegram.org'],
    Discord: ['discord.gg', 'discord.com'],
    X: ['x.com', 'twitter.com', 't.co'],
    'Twitter / X': ['x.com', 'twitter.com', 't.co'],
    Threads: ['threads.net'],
    GitHub: ['github.com'],
    Behance: ['behance.net'],
    Dribbble: ['dribbble.com'],
    Pinterest: ['pinterest.com', 'pin.it'],
    Snapchat: ['snapchat.com'],
    Medium: ['medium.com']
  };
  const keywords = rules[platform];
  if (!keywords) return true;
  return keywords.some(keyword => lowerUrl.includes(keyword));
};
export default function Profile() {
  const { updateUser } = useAuth();
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
    educational_qualification: '',
    profession: '',
    bfi_batch: '',
    mobile_number: '',
    whatsapp_number: '',
    bio: '',
    profile_picture: ''
  });

  const availableSocialPlatforms = [
    'Facebook', 'YouTube', 'Vimeo', 'LinkedIn', 'Instagram', 'TikTok',
    'WhatsApp', 'Telegram', 'Discord', 'X', 'Threads', 'GitHub',
    'Behance', 'Dribbble', 'Pinterest', 'Snapchat', 'Medium', 'Website', 'Other'
  ];

  // Modal & Cropping State
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropImage, setCropImage] = useState('');
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const [openDropdown, setOpenDropdown] = useState(null);

  const [isSocialListVisible, setIsSocialListVisible] = useState(false);
  const [socialSaveStatus, setSocialSaveStatus] = useState('idle');
  const socialSnapshotRef = useRef('');
  const dropdownRef = useRef(null);
  const formDataRef = useRef(formData);

  const socialPlatformMeta = {
    Facebook: { color: '#1877F2', Icon: FaFacebookF, placeholder: 'https://www.facebook.com/your-profile' },
    YouTube: { color: '#FF0000', Icon: FaYoutube, placeholder: 'https://www.youtube.com/@your-channel' },
    Vimeo: { color: '#1AB7EA', Icon: FaVimeoV, placeholder: 'https://vimeo.com/your-profile' },
    LinkedIn: { color: '#0A66C2', Icon: FaLinkedinIn, placeholder: 'https://www.linkedin.com/in/your-profile' },
    Instagram: { color: '#E4405F', Icon: FaInstagram, placeholder: 'https://www.instagram.com/your-profile' },
    TikTok: { color: '#25F4EE', Icon: FaTiktok, placeholder: 'https://www.tiktok.com/@your-handle' },
    WhatsApp: { color: '#25D366', Icon: FaWhatsapp, placeholder: 'https://wa.me/8801XXXXXXXXX' },
    Telegram: { color: '#26A5E4', Icon: FaTelegram, placeholder: 'https://t.me/your-username' },
    Discord: { color: '#5865F2', Icon: FaDiscord, placeholder: 'https://discord.gg/your-server' },
    X: { color: '#FFFFFF', Icon: FaXTwitter, placeholder: 'https://x.com/your-handle' },
    'Twitter / X': { color: '#FFFFFF', Icon: FaXTwitter, placeholder: 'https://x.com/your-handle' },
    Threads: { color: '#FFFFFF', Icon: FaThreads, placeholder: 'https://www.threads.net/@your-handle' },
    GitHub: { color: '#F0F6FC', Icon: FaGithub, placeholder: 'https://github.com/your-username' },
    Behance: { color: '#1769FF', Icon: FaBehance, placeholder: 'https://www.behance.net/your-profile' },
    Dribbble: { color: '#EA4C89', Icon: FaDribbble, placeholder: 'https://dribbble.com/your-profile' },
    Pinterest: { color: '#E60023', Icon: FaPinterestP, placeholder: 'https://www.pinterest.com/your-profile' },
    Snapchat: { color: '#FFFC00', Icon: FaSnapchat, placeholder: 'https://www.snapchat.com/add/your-username' },
    Medium: { color: '#FFFFFF', Icon: FaMedium, placeholder: 'https://medium.com/@your-profile' },
    Website: { color: '#10b981', Icon: FaGlobe, placeholder: 'https://yourwebsite.com' },
    Other: { color: '#8b5cf6', Icon: FaLink, placeholder: 'https://...' }
  };


  const maleAvatars = profile?.role === 'instructor' || profile?.role === 'admin' ? [
    { url: 'avatars/teacher_male.png', scale: 1.0, originY: 'center' },
    { url: 'avatars/teacher_male_2.png', scale: 1.0, originY: 'center' },
    { url: 'avatars/teacher_male_3.png', scale: 1.0, originY: 'center' },
    { url: 'avatars/teacher_male_4.png', scale: 1.0, originY: 'center' },
    { url: 'avatars/teacher_male_5.png', scale: 1.0, originY: 'center' }
  ] : [
    { url: 'avatars/male1.png', scale: 1.5, originY: '30%' },
    { url: 'avatars/male2.png', scale: 1.6, originY: '28%' },
    { url: 'avatars/male_15.png', scale: 2.8, originY: '12%' },
    { url: 'avatars/male_25.png', scale: 2.5, originY: '15%' },
    { url: 'avatars/male_35.png', scale: 2.2, originY: '15%' },
    { url: 'avatars/male_45.png', scale: 1.8, originY: '20%' },
    { url: 'avatars/male_55.png', scale: 1.8, originY: '18%' }
  ];

  const femaleAvatars = profile?.role === 'instructor' || profile?.role === 'admin' ? [
    { url: 'avatars/teacher_female.png', scale: 1.0, originY: 'center' },
    { url: 'avatars/teacher_female_2.png', scale: 1.0, originY: 'center' },
    { url: 'avatars/teacher_female_3.png', scale: 1.0, originY: 'center' },
    { url: 'avatars/teacher_female_4.png', scale: 1.0, originY: 'center' },
    { url: 'avatars/teacher_female_5.png', scale: 1.0, originY: 'center' }
  ] : [
    { url: 'avatars/female1.png', scale: 1.5, originY: '28%' },
    { url: 'avatars/female2.png', scale: 1.5, originY: '25%' },
    { url: 'avatars/female_15.png', scale: 3.0, originY: '12%' },
    { url: 'avatars/female_25.png', scale: 2.8, originY: '12%' },
    { url: 'avatars/female_35.png', scale: 2.5, originY: '12%' },
    { url: 'avatars/female_45.png', scale: 2.2, originY: '15%' },
    { url: 'avatars/female_55.png', scale: 1.8, originY: '18%' }
  ];

  const getFullUrl = (path) => {
    const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    return `${base}${path}`;
  };

  const normalizeExternalUrl = (url) => {
    const trimmed = (url || '').trim();
    if (!trimmed) return '';
    if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenDropdown(null);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOpenDropdown(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
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
          educational_qualification: data.educational_qualification || '',
          profession: data.profession || '',
          bfi_batch: data.bfi_batch || '',
          mobile_number: data.mobile_number || '',
          whatsapp_number: data.whatsapp_number || '',
          bio: data.bio || '',
          profile_picture: data.profile_picture || ''
        });
        const fetchedSocialLinks = data.socialLinks || [];
        setSocialLinks(fetchedSocialLinks);
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
    setIsSocialListVisible(true);
    const nextLinks = [...socialLinks, { platform: 'Facebook', url: '' }];
    setSocialLinks(nextLinks);
    setOpenDropdown(nextLinks.length - 1);
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
    setOpenDropdown(null);
  };

  const saveSocialLinks = async (linksToSave) => {
    try {
      const payload = {
        ...formDataRef.current,
        socialLinks: linksToSave
      };
      const res = await fetch('/api/student/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(payload)
      });
      return res.ok;
    } catch (err) {
      console.error('Failed to save social links', err);
      return false;
    }
  };


  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCropImage(reader.result);
        setShowCropModal(true);
        setZoom(1);
        setPosition({ x: 0, y: 0 });
      };
      reader.readAsDataURL(file);
    }
  };

  const selectAvatar = async (avatarUrl) => {
    setFormData({ ...formData, profile_picture: avatarUrl });
    
    // Auto-save avatar selection to server immediately
    try {
      const res = await fetch('/api/student/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ 
          ...formData, 
          profile_picture: avatarUrl 
        })
      });
      if (res.ok) {
        if (updateUser) {
          updateUser({ profile_picture: avatarUrl });
        }
        setMessage('Avatar updated successfully!');
        setTimeout(() => setMessage(''), 3000);
      }
    } catch (err) {
      console.error('Failed to save avatar:', err);
    }
  };

  const handleMouseDown = () => {
    setIsDragging(true);
    // Focus on the container to ensure move events are captured well
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    // Use movementX/Y for relative positioning
    setPosition(prev => ({
      x: prev.x + e.movementX,
      y: prev.y + e.movementY
    }));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const saveCroppedImage = async () => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 400; // Resolution of the saved image
      canvas.width = size;
      canvas.height = size;

      const img = new Image();
      img.src = cropImage;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      // Calculate the drawing parameters
      // The UI circle is 300px. We translate by position.x/y.
      const scale = zoom;
      const x = position.x * (size / 300);
      const y = position.y * (size / 300);
      
      const imgAspect = img.width / img.height;
      let drawW, drawH;
      
      if (imgAspect > 1) {
        drawH = size * scale;
        drawW = size * imgAspect * scale;
      } else {
        drawW = size * scale;
        drawH = (size / imgAspect) * scale;
      }

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, size, size);
      
      ctx.drawImage(
        img,
        (size - drawW) / 2 + x,
        (size - drawH) / 2 + y,
        drawW,
        drawH
      );

      const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.9);
      
      // Update local state and immediately upload
      const newBio = formData.bio;
      setFormData(prev => ({ ...prev, profile_picture: croppedDataUrl, bio: newBio }));
      
      const res = await fetch('/api/student/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ 
          ...formData, 
          profile_picture: croppedDataUrl, 
          bio: newBio 
        })
      });

      if (res.ok) {
        if (updateUser) {
          updateUser({ profile_picture: croppedDataUrl });
          
          // Sync with demo cache if on GitHub Pages
          if (window.location.hostname.includes('github.io')) {
            const cached = localStorage.getItem('demo_user_cache');
            if (cached) {
              const userData = JSON.parse(cached);
              userData.profile_picture = croppedDataUrl;
              localStorage.setItem('demo_user_cache', JSON.stringify(userData));
            }
          }
        }
        setShowCropModal(false);
        setMessage('Profile picture updated successfully!');
        setTimeout(() => setMessage(''), 3000);
      } else {
        throw new Error('Upload failed');
      }
    } catch (err) {
      console.error('Save failed', err);
      alert('Failed to save and upload image. Please try again.');
    }
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
        if (updateUser) {
          updateUser({ profile_picture: formData.profile_picture });
          
          // Sync with demo cache if on GitHub Pages
          if (window.location.hostname.includes('github.io')) {
            const cached = localStorage.getItem('demo_user_cache');
            if (cached) {
              const userData = JSON.parse(cached);
              userData.profile_picture = formData.profile_picture;
              localStorage.setItem('demo_user_cache', JSON.stringify(userData));
            }
          }
        }
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
    <>

      {message && (
        <div className="alert-glass animate-fade-in" style={{ 
          position: 'fixed', bottom: '32px', left: '50%', transform: 'translateX(-50%)', 
          zIndex: 99999, padding: '0.85rem 2rem', borderRadius: '14px',
          background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.35)',
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          color: '#4ade80', fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)', fontSize: '0.9rem',
          whiteSpace: 'nowrap', pointerEvents: 'none'
        }}>
          <CheckCircle2 size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} /> {message}
        </div>
      )}

    <div className="page-container container" style={{ paddingBottom: '4rem', maxWidth: '1000px', margin: '0 auto' }}>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2rem', marginBottom: '3rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <div style={{ 
            width: '150px', 
            height: '150px', 
            borderRadius: '50%', 
            background: 'var(--bg-gradient-primary)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            fontSize: '3.5rem', 
            fontWeight: 'bold',
            overflow: 'hidden',
            border: '4px solid var(--accent-primary)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
          }}>
            {formData.profile_picture ? (
              <img src={resolveMediaUrl(formData.profile_picture)} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <img src={`${import.meta.env.BASE_URL}${profile?.role === 'instructor' || profile?.role === 'admin' ? `avatars/teacher_${formData.gender === 'Female' ? 'female' : 'male'}.png` : `avatars/${formData.gender === 'Female' ? 'female1' : 'male1'}.png`}`} alt="Default" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
            )}
          </div>
          <label 
            htmlFor="profile-upload" 
            style={{ 
              position: 'absolute', 
              bottom: '5px', 
              right: '5px', 
              background: 'var(--accent-primary)', 
              borderRadius: '50%', 
              width: '40px', 
              height: '40px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              cursor: 'pointer', 
              color: 'black',
              boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
              transition: 'transform 0.2s',
              zIndex: 10
            }}
            className="hover-scale"
          >
            <Camera size={20} />
            <input 
              id="profile-upload" 
              type="file" 
              accept="image/*" 
              onChange={handleFileChange} 
              style={{ display: 'none' }} 
            />
          </label>
        </div>
        <div style={{ flex: 1, minWidth: '300px' }}>
          <h1 className="font-display" style={{ fontSize: '2.5rem', margin: 0 }}>{profile?.full_name}</h1>
          <div style={{ marginTop: '1.5rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem', letterSpacing: '0.03em' }}>Select an avatar:</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--accent-primary)', width: '50px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Male</span>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {maleAvatars.map((av, i) => {
                    const isSelected = formData.profile_picture === getFullUrl(av.url);
                    return (
                      <div 
                        key={i}
                        onClick={() => selectAvatar(getFullUrl(av.url))}
                        style={{ 
                          width: '48px', 
                          height: '48px', 
                          borderRadius: '50%', 
                          cursor: 'pointer',
                          border: isSelected ? '2.5px solid var(--accent-primary)' : '2px solid rgba(255,255,255,0.1)',
                          padding: '2px',
                          transition: 'all 0.25s ease',
                          background: isSelected ? 'rgba(225,29,72,0.1)' : 'rgba(255,255,255,0.03)',
                          overflow: 'hidden',
                          boxShadow: isSelected ? '0 0 12px rgba(225,29,72,0.3)' : 'none',
                          flexShrink: 0
                        }}
                        className="hover-scale"
                      >
                        <img 
                          src={getFullUrl(av.url)} 
                          alt="Male Avatar"
                          style={{ 
                            width: '100%', 
                            height: '100%', 
                            borderRadius: '50%', 
                            objectFit: 'cover',
                            objectPosition: 'top',
                            transform: `scale(${av.scale})`,
                            transformOrigin: `center ${av.originY}`
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.65rem', color: '#f472b6', width: '50px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Female</span>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {femaleAvatars.map((av, i) => {
                    const isSelected = formData.profile_picture === getFullUrl(av.url);
                    return (
                      <div 
                        key={i}
                        onClick={() => selectAvatar(getFullUrl(av.url))}
                        style={{ 
                          width: '48px', 
                          height: '48px', 
                          borderRadius: '50%', 
                          cursor: 'pointer',
                          border: isSelected ? '2.5px solid #f472b6' : '2px solid rgba(255,255,255,0.1)',
                          padding: '2px',
                          transition: 'all 0.25s ease',
                          background: isSelected ? 'rgba(244,114,182,0.1)' : 'rgba(255,255,255,0.03)',
                          overflow: 'hidden',
                          boxShadow: isSelected ? '0 0 12px rgba(244,114,182,0.3)' : 'none',
                          flexShrink: 0
                        }}
                        className="hover-scale"
                      >
                        <img 
                          src={getFullUrl(av.url)} 
                          alt="Female Avatar"
                          style={{ 
                            width: '100%', 
                            height: '100%', 
                            borderRadius: '50%', 
                            objectFit: 'cover',
                            objectPosition: 'top',
                            transform: `scale(${av.scale})`,
                            transformOrigin: `center ${av.originY}`
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Instructor Details */}
      {profile?.role === 'instructor' && (
        <section className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', border: '1px solid var(--accent-primary)' }}>
          <h3 className="font-display" style={{ margin: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Award size={20} className="text-accent" /> Instructor Profile
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {profile?.subjects ? JSON.parse(profile.subjects).map((sub, i) => (
              <span key={i} className="badge-pill" style={{ background: 'var(--accent-primary)', color: 'white' }}>{sub}</span>
            )) : <span className="text-muted">No subjects assigned.</span>}
          </div>
        </section>
      )}

      {/* Live Course Progression Tracker (Students only) */}
      {profile?.role === 'student' && (
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
                  <NavLink to="/certificates" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
                    <Download size={14} /> Download Certificate
                  </NavLink>
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
      )}

      <form onSubmit={handleSave}>
        
        {/* Core Institutional Info (Non-editable) - Students Only */}
        {profile?.role === 'student' && (
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
                <input type="text" className="input-glass" readOnly value={profile?.batch_number ? `${getOrdinalSuffix(profile.batch_number)} Batch` : ''} disabled style={{ cursor: 'not-allowed' }} />
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
        )}

        {/* Personal Details - All Users */}
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
            <div className="input-group">
              <label>Educational Qualification</label>
              <input type="text" name="educational_qualification" value={formData.educational_qualification} onChange={handleChange} className="input-glass" placeholder="Highest degree or current study" />
            </div>
            <div className="input-group">
              <label>Profession</label>
              <input type="text" name="profession" value={formData.profession} onChange={handleChange} className="input-glass" placeholder="Current job title or role" />
            </div>
            {profile?.role === 'instructor' && (
              <div className="input-group">
                <label>BFI Batch <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>(Optional)</span></label>
                <input type="text" name="bfi_batch" value={formData.bfi_batch} onChange={handleChange} className="input-glass" placeholder="e.g. Batch 5" />
              </div>
            )}
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

          <div style={{ marginTop: '2.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Link2 size={18} style={{ color: 'var(--accent-secondary)' }} />
                <label style={{ fontSize: '1rem', fontWeight: 600 }}>Social Links</label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" onClick={addSocialLink} className="btn btn-glass" style={{ padding: '0.45rem 1rem', fontSize: '0.8rem', borderRadius: '20px', gap: '0.4rem' }}>
                  <Plus size={14} /> Add link
                </button>
              </div>
            </div>

            {socialLinks.some((link) => link.url?.trim()) && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                flexWrap: 'wrap',
                marginBottom: '1rem',
                padding: '0.75rem',
                borderRadius: '14px',
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.06)'
              }}>
                {socialLinks.filter((link) => link.url?.trim()).map((link, index) => {
                  const meta = socialPlatformMeta[link.platform] || socialPlatformMeta.Other;
                  const PlatformIcon = meta.Icon;
                  return (
                    <a
                      key={`${link.platform}-${index}`}
                      href={normalizeExternalUrl(link.url)}
                      target="_blank"
                      rel="noreferrer"
                      title={link.platform}
                      aria-label={`Open ${link.platform}`}
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: ['#FFFFFF', '#F0F6FC'].includes(meta.color) ? undefined : meta.color,
                        background: ['#FFFFFF', '#F0F6FC'].includes(meta.color) ? undefined : `${meta.color}16`,
                        border: ['#FFFFFF', '#F0F6FC'].includes(meta.color) ? undefined : `1px solid ${meta.color}38`,
                        textDecoration: 'none',
                        boxShadow: ['#FFFFFF', '#F0F6FC'].includes(meta.color) ? undefined : `0 8px 24px ${meta.color}10`,
                        transition: 'transform 0.15s ease, border-color 0.15s ease'
                      }}
                      className={['#FFFFFF', '#F0F6FC'].includes(meta.color) ? "bw-social" : ""}
                      onMouseEnter={(event) => {
                        event.currentTarget.style.transform = 'translateY(-2px)';
                        event.currentTarget.style.borderColor = `${meta.color}80`;
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.transform = 'translateY(0)';
                        event.currentTarget.style.borderColor = `${meta.color}38`;
                      }}
                    >
                      <PlatformIcon size={20} />
                    </a>
                  );
                })}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setIsSocialListVisible((prev) => !prev);
                  }}
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    marginLeft: 'auto'
                  }}
                  title="Edit Social Links"
                  className="hover-scale"
                >
                  <Pencil size={18} />
                </button>
              </div>
            )}
            
            <div 
              style={{
                display: 'grid',
                gridTemplateRows: isSocialListVisible ? '1fr' : '0fr',
                opacity: isSocialListVisible ? 1 : 0,
                transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
                pointerEvents: isSocialListVisible ? 'auto' : 'none',
                marginTop: isSocialListVisible ? '0.5rem' : '0'
              }}
            >
              <div style={{ overflow: openDropdown !== null ? 'visible' : 'hidden' }}>
                <div ref={dropdownRef} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingBottom: '0.5rem' }}>
              {socialLinks.map((link, index) => {
                const meta = socialPlatformMeta[link.platform] || socialPlatformMeta.Other;
                const PlatformIcon = meta.Icon;
                const pColor = meta.color;
                const isDropdownOpen = openDropdown === index;
                const isInvalid = !validateSocialLink(link.platform, link.url);
                return (
                  <div key={`new-${index}`} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    padding: '0.9rem',
                    borderRadius: '14px',
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${`${pColor}55`}`,
                    transition: 'all 0.2s ease',
                    boxShadow: `0 10px 30px ${pColor}12`
                  }}>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDropdown(isDropdownOpen ? null : index);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.6rem 0.8rem',
                          borderRadius: '10px',
                          background: ['#FFFFFF', '#F0F6FC'].includes(meta.color) ? undefined : `${pColor}15`,
                          border: ['#FFFFFF', '#F0F6FC'].includes(meta.color) ? undefined : `1px solid ${pColor}45`,
                          color: ['#FFFFFF', '#F0F6FC'].includes(meta.color) ? undefined : pColor,
                          cursor: 'pointer',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          minWidth: '148px',
                          justifyContent: 'space-between',
                          transition: 'all 0.15s ease'
                        }}
                        className={['#FFFFFF', '#F0F6FC'].includes(meta.color) ? "bw-social" : ""}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                          <span style={{
                            minWidth: '28px',
                            height: '28px',
                            borderRadius: '999px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: `${pColor}22`,
                            border: `1px solid ${pColor}33`,
                            fontSize: '0.72rem',
                            fontWeight: 800
                          }}>
                            <PlatformIcon size={14} />
                          </span>
                          {link.platform}
                        </span>
                        <ChevronDown size={14} style={{
                          opacity: 0.7,
                          transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s ease'
                        }} />
                      </button>

                        <div style={{ flex: '1 1 260px', minWidth: '220px', display: 'flex', flexDirection: 'column' }}>
                          <input
                            type="url"
                            value={link.url}
                            onChange={(e) => updateSocialLink(index, 'url', e.target.value)}
                            onBlur={() => {}}
                            className="input-glass"
                            placeholder={meta.placeholder}
                            style={{
                              width: '100%',
                              fontSize: '0.85rem',
                              padding: '0.7rem 0.9rem',
                              borderRadius: '10px',
                              background: 'rgba(255,255,255,0.04)',
                              border: `1px solid ${isInvalid ? '#f87171' : 'rgba(255,255,255,0.08)'}`
                            }}
                          />
                          {isInvalid && (
                            <span style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.35rem', marginLeft: '0.2rem' }}>
                              URL does not match selected platform. Choose 'Other' if needed.
                            </span>
                          )}
                        </div>

                      <button
                        type="button"
                        onClick={() => removeSocialLink(index)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '0.55rem',
                          borderRadius: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s',
                          flexShrink: 0
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                      >
                        <X size={16} />
                      </button>
                    </div>

                    {isDropdownOpen && (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: '0.55rem',
                        paddingTop: '0.15rem'
                      }}>
                        {availableSocialPlatforms.map((platform) => {
                          const platformMeta = socialPlatformMeta[platform] || socialPlatformMeta.Other;
                          const OptionIcon = platformMeta.Icon;
                          const isSelected = link.platform === platform;
                          return (
                            <button
                              key={platform}
                              type="button"
                              onClick={() => {
                                updateSocialLink(index, 'platform', platform);
                                setOpenDropdown(null);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.6rem',
                                width: '100%',
                                padding: '0.75rem 0.85rem',
                                borderRadius: '12px',
                                border: `1px solid ${isSelected ? `${platformMeta.color}55` : 'rgba(255,255,255,0.08)'}`,
                                cursor: 'pointer',
                                fontSize: '0.83rem',
                                fontWeight: isSelected ? 700 : 500,
                                background: isSelected ? `${platformMeta.color}18` : 'rgba(255,255,255,0.02)',
                                color: isSelected ? platformMeta.color : '#d1d1d6',
                                transition: 'all 0.12s ease'
                              }}
                            >
                              <span style={{
                                minWidth: '26px',
                                height: '26px',
                                borderRadius: '999px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: `${platformMeta.color}22`,
                                border: `1px solid ${platformMeta.color}33`,
                                fontSize: '0.7rem',
                                fontWeight: 800
                              }}>
                                <OptionIcon size={13} />
                              </span>
                              <span>{platform}</span>
                              {isSelected && <CheckCircle2 size={14} style={{ marginLeft: 'auto', color: platformMeta.color }} />}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      flexWrap: 'wrap'
                    }}>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        {link.url ? `Selected: ${link.platform}` : `Choose ${link.platform} and paste the profile link`}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                        <button
                          type="button"
                          onClick={() => setOpenDropdown(isDropdownOpen ? null : index)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: pColor,
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            padding: 0
                          }}
                        >
                          {isDropdownOpen ? 'Close options' : 'Change platform'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {openDropdown === 'legacy-social-picker' && socialLinks.map((link, index) => {
                const platformColors = {
                  'Facebook': '#1877F2', 'YouTube': '#FF0000', 'Vimeo': '#1AB7EA',
                  'LinkedIn': '#0A66C2', 'Instagram': '#E4405F', 'Twitter / X': '#1DA1F2',
                  'Website': '#10b981', 'Other': '#8b5cf6'
                };
                const platformIcons = {
                  'Facebook': '📘', 'YouTube': '▶️', 'Vimeo': '🎬',
                  'LinkedIn': '💼', 'Instagram': '📷', 'Twitter / X': '𝕏',
                  'Website': '🌐', 'Other': '🔗'
                };
                const pColor = platformColors[link.platform] || '#8b5cf6';
                const isDropdownOpen = openDropdown === index;
                return (
                  <div key={index} style={{ 
                    display: 'flex', gap: '0.5rem', alignItems: 'center',
                    padding: '0.6rem 0.75rem', borderRadius: '10px',
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    transition: 'all 0.2s ease'
                  }}>
                    {/* Custom platform dropdown */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDropdown(isDropdownOpen ? null : index);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.5rem',
                          padding: '0.45rem 0.7rem', borderRadius: '8px',
                          background: `${pColor}15`, border: `1px solid ${pColor}30`,
                          color: pColor, cursor: 'pointer', fontSize: '0.82rem',
                          fontWeight: 600, minWidth: '130px', justifyContent: 'space-between',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.9rem' }}>{platformIcons[link.platform] || '🔗'}</span>
                          {link.platform}
                        </span>
                        <ChevronDown size={14} style={{ 
                          opacity: 0.7, 
                          transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s ease'
                        }} />
                      </button>

                      {isDropdownOpen && (
                        <>
                          <div 
                            onClick={() => setOpenDropdown(null)} 
                            style={{ position: 'fixed', inset: 0, zIndex: 999 }} 
                          />
                          <div style={{
                            position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                            zIndex: 1000, minWidth: '180px',
                            background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '10px', padding: '0.35rem',
                            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
                            backdropFilter: 'blur(20px)',
                            animation: 'fadeIn 0.15s ease'
                          }}>
                            {availableSocialPlatforms.map(p => {
                              const pc = platformColors[p] || '#8b5cf6';
                              const isSelected = link.platform === p;
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => {
                                    updateSocialLink(index, 'platform', p);
                                    setOpenDropdown(null);
                                  }}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                                    width: '100%', padding: '0.5rem 0.7rem', borderRadius: '7px',
                                    border: 'none', cursor: 'pointer', fontSize: '0.83rem',
                                    fontWeight: isSelected ? 600 : 400,
                                    background: isSelected ? `${pc}18` : 'transparent',
                                    color: isSelected ? pc : '#d1d1d6',
                                    transition: 'all 0.12s ease'
                                  }}
                                  onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; } }}
                                  onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.background = 'transparent'; } }}
                                >
                                  <span style={{ fontSize: '0.95rem', width: '22px', textAlign: 'center' }}>{platformIcons[p] || '🔗'}</span>
                                  <span>{p}</span>
                                  {isSelected && <CheckCircle2 size={13} style={{ marginLeft: 'auto', color: pc }} />}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>

                    {/* URL Input */}
                    <input 
                      type="url" 
                      value={link.url} 
                      onChange={(e) => updateSocialLink(index, 'url', e.target.value)} 
                      className="input-glass" 
                      placeholder="https://..." 
                      style={{ 
                        flex: 1, fontSize: '0.85rem', padding: '0.5rem 0.75rem',
                        borderRadius: '8px', background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)'
                      }}
                    />

                    {/* Remove button */}
                    <button 
                      type="button" 
                      onClick={() => removeSocialLink(index)} 
                      style={{ 
                        background: 'transparent', border: 'none', 
                        color: 'var(--text-muted)', cursor: 'pointer', padding: '0.35rem',
                        borderRadius: '6px', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', transition: 'all 0.15s', flexShrink: 0
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                );
              })}
              {socialLinks.length === 0 && isSocialListVisible && (
                <div style={{ 
                  textAlign: 'center', padding: '2.5rem 1rem', 
                  background: 'rgba(255,255,255,0.015)', borderRadius: '12px',
                  border: '1px dashed rgba(255,255,255,0.08)'
                }}>
                  <Link2 size={28} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem', opacity: 0.5 }} />
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>No social links added yet</p>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.3rem 0 0', opacity: 0.6 }}>Click "Add link" to connect your social profiles</p>
                </div>
              )}

              {/* Global Done Button */}
              {socialLinks.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => {
                      const invalidLink = socialLinks.find(link => !validateSocialLink(link.platform, link.url));
                      if (invalidLink) {
                        alert(`The link "${invalidLink.url}" does not match the selected platform (${invalidLink.platform}). Please select the correct platform or choose 'Other'.`);
                        return;
                      }
                      setOpenDropdown(null);
                      setSocialSaveStatus('saving');
                      saveSocialLinks(socialLinks).then((saved) => {
                        if (saved) {
                          socialSnapshotRef.current = JSON.stringify(socialLinks);
                          setSocialSaveStatus('saved');
                          window.setTimeout(() => setSocialSaveStatus('idle'), 1600);
                          setIsSocialListVisible(false);
                        } else {
                          setSocialSaveStatus('error');
                        }
                      });
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: 'var(--text-primary)',
                      padding: '0.6rem 1.6rem',
                      borderRadius: '10px',
                      fontSize: '0.88rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
                  >
                    {socialSaveStatus === 'saving' ? 'Saving...' : 'Done'}
                  </button>
                </div>
              )}
                </div>
              </div>
            </div>
            
            {!isSocialListVisible && !socialLinks.some((link) => link.url?.trim()) && (
              <div style={{ 
                textAlign: 'center', padding: '2.5rem 1rem', 
                background: 'rgba(255,255,255,0.015)', borderRadius: '12px',
                border: '1px dashed rgba(255,255,255,0.08)'
              }}>
                <Link2 size={28} style={{ color: 'var(--text-muted)', marginBottom: '0.75rem', opacity: 0.5 }} />
                <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>No social links added yet</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.3rem 0 0', opacity: 0.6 }}>Click "Add link" to connect your social profiles</p>
              </div>
            )}
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

    {showCropModal && (
      <div style={{ 
        position: 'fixed', inset: 0, width: '100vw', height: '100vh', 
        background: 'rgba(0,0,0,0.6)', zIndex: 9999999, 
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        overscrollBehavior: 'contain'
      }} onClick={() => setShowCropModal(false)}>
        <div className="glass-panel animate-modal-entrance" style={{ 
          width: '100%', maxWidth: '550px', borderRadius: '32px',
          background: '#0a0a0c', border: '1px solid rgba(255,255,255,0.1)',
          position: 'relative', overflow: 'hidden',
          boxShadow: '0 40px 100px rgba(0,0,0,0.8)'
        }} onClick={e => e.stopPropagation()}>
          
          <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.4rem', fontWeight: '700' }}>Choose profile picture</h3>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Drag to reposition and use slider to zoom</p>
            </div>
            <button onClick={() => setShowCropModal(false)} style={{ background: 'rgba(128,128,128,0.1)', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={20} /></button>
          </div>

          <div style={{ padding: '2rem' }}>
            <div 
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ 
                position: 'relative', width: '100%', aspectRatio: '1/1', 
                display: 'flex', alignItems: 'center', justifyContent: 'center', 
                marginBottom: '2rem', userSelect: 'none', overflow: 'hidden',
                borderRadius: '16px', background: '#000', cursor: isDragging ? 'grabbing' : 'grab'
              }}
            >
              <div style={{ 
                width: '320px', height: '320px', borderRadius: '50%', overflow: 'hidden', 
                position: 'relative', border: '4px solid var(--accent-primary)',
                boxShadow: '0 0 0 1000px rgba(0,0,0,0.85)', zIndex: 2, pointerEvents: 'none'
              }}>
                <img 
                  src={cropImage} 
                  alt="To Crop" 
                  style={{ 
                    position: 'absolute', left: '50%', top: '50%',
                    transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${zoom})`,
                    transformOrigin: 'center', maxWidth: 'none', height: '320px', width: 'auto',
                    transition: isDragging ? 'none' : 'transform 0.1s ease-out', zIndex: 1
                  }} 
                />
              </div>
              
              <div style={{ 
                position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', 
                background: 'rgba(0,0,0,0.8)', padding: '8px 16px', borderRadius: '20px', 
                fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '8px',
                color: 'white', border: '1px solid rgba(255,255,255,0.1)', zIndex: 10
              }}>
                <Move size={14} /> Drag image to adjust
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem', marginBottom: '2rem' }}>
              <ImageIcon size={18} className="text-muted" />
              <input 
                type="range" min="1" max="5" step="0.01" value={zoom} 
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
              />
              <Plus size={18} className="text-muted" />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button onClick={() => setShowCropModal(false)} className="btn btn-glass" style={{ padding: '0.7rem 1.5rem' }}>Cancel</button>
              <button onClick={saveCroppedImage} className="btn btn-primary" style={{ padding: '0.7rem 2.5rem', fontWeight: '700' }}>Save</button>
            </div>
          </div>
        </div>
      </div>
    )}

    <style>{`
      @keyframes modalEntrance {
        from { opacity: 0; transform: scale(0.95) translateY(20px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .hover-scale:hover { transform: scale(1.1); }
    `}</style>
    </>
  );
}
