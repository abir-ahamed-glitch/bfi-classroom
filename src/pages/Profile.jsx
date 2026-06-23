import { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { resolveMediaUrl } from '../utils/mediaUtils';
import { getOrdinalSuffix } from '../utils/formatUtils';
import { useModal } from '../components/BFIModal';
import { 
  User, Mail, Phone, MapPin, Calendar, CheckSquare, 
  Lock, AlertCircle, Save, CheckCircle2, Link2, Plus, X, ChevronDown,
  Award, BookOpen, Film, Download, CheckCircle, Briefcase, Camera, Image as ImageIcon, Move,
  Pencil, ExternalLink, Video, Play, Trash2, Globe, Scale, Users, GraduationCap, Clapperboard
} from 'lucide-react';
import {
  FaBehance, FaDiscord, FaDribbble, FaFacebookF, FaGithub, FaGlobe,
  FaInstagram, FaLinkedinIn, FaMedium, FaPinterestP, FaSnapchat,
  FaTelegram, FaThreads, FaTiktok, FaVimeoV, FaWhatsapp, FaXTwitter,
  FaYoutube
} from 'react-icons/fa6';
import { FaLink } from 'react-icons/fa';
import PrivacySelector from '../components/PrivacySelector';

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
const standardTypes = ['Film', 'Jury', 'Curator', 'Teaching', 'Writing', 'Distribution', 'Cultural', 'Workshop', 'Award', 'Education'];

export default function Profile() {
  const { updateUser } = useAuth();
  const { showAlert, showConfirm } = useModal();
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

  const [privacySettings, setPrivacySettings] = useState({});

  const handlePrivacyChange = (fieldName, value) => {
    setPrivacySettings(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  // ── Portfolio state ───────────────────────────────────────────────
  const [projects, setProjects] = useState([]);
  const [showPortfolioModal, setShowPortfolioModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [playingProjectId, setPlayingProjectId] = useState(null);
  const [brokenThumbs, setBrokenThumbs] = useState({});
  const portfolioInitialForm = {
    title: '', duration: '', genre: '', synopsis: '', media_link: '',
    media_source: 'youtube', poster_url: '', privacy_setting: 'public',
    show_on_dashboard: true, show_on_community: true,
  };
  const [portfolioForm, setPortfolioForm] = useState(portfolioInitialForm);
  const [credits, setCredits] = useState([]);
  const [awards, setAwards] = useState([]);
  const [creditRole, setCreditRole] = useState('Director');
  const [creditName, setCreditName] = useState('');
  const [awardData, setAwardData] = useState({ awardName: '', festivalName: '', awardYear: '' });
  const portfolioRoleOptions = [
    'Director', 'Producer', 'Actor', 'Actress', 'Cinematographer',
    'Script Writer', 'Screenplay Writer', 'Story', 'Researcher',
    'Editor', 'Sound Designer', 'Art Director', 'Graphics', 'Animation', 'Crew'
  ];

  // ── Experience state ─────────────────────────────────────────────
  const [showExpModal, setShowExpModal] = useState(false);
  const [editingExpId, setEditingExpId] = useState(null);
  const expInitialForm = {
    title: '', organization: '', experience_type: 'Film',
    start_date: '', end_date: '', description: ''
  };
  const [expForm, setExpForm] = useState(expInitialForm);

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
        setPrivacySettings(data.privacySettings || {});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ── Portfolio helpers & CRUD ──────────────────────────────────────
  const fetchPortfolio = async () => {
    try {
      const res = await fetch('/api/portfolio', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) setProjects(await res.json());
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchPortfolio(); }, []);

  const addCredit = () => {
    if (creditName.trim()) {
      setCredits([...credits, { role: creditRole, name: creditName.trim() }]);
      setCreditName('');
    }
  };
  const removeCredit = (idx) => setCredits(credits.filter((_, i) => i !== idx));
  const addAward = () => {
    if (awardData.awardName.trim()) {
      setAwards([...awards, { ...awardData }]);
      setAwardData({ awardName: '', festivalName: '', awardYear: '' });
    }
  };
  const removeAward = (idx) => setAwards(awards.filter((_, i) => i !== idx));

  const openPortfolioEdit = (proj) => {
    setEditingProject(proj);
    setPortfolioForm({
      title: proj.title || '', duration: proj.duration || '',
      genre: proj.genre || '', synopsis: proj.synopsis || '',
      media_link: proj.media_link || '', media_source: proj.media_source || 'youtube',
      poster_url: proj.poster_url || '', privacy_setting: proj.privacy_setting || 'public',
      show_on_dashboard: proj.show_on_dashboard === 1,
      show_on_community: proj.show_on_community === 1,
    });
    setCredits(proj.credits ? proj.credits.map(c => ({ role: c.role, name: c.name })) : []);
    setAwards(proj.awards ? proj.awards.map(a => ({ awardName: a.award_name, festivalName: a.festival_name, awardYear: a.award_year })) : []);
    setShowPortfolioModal(true);
  };
  const closePortfolioModal = () => {
    setShowPortfolioModal(false); setEditingProject(null);
    setPortfolioForm(portfolioInitialForm); setCredits([]); setAwards([]);
  };
  const handlePortfolioSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...portfolioForm, credits, awards };
      const isEditing = !!editingProject;
      const res = await fetch(isEditing ? `/api/portfolio/${editingProject.id}` : '/api/portfolio', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(payload)
      });
      if (res.ok) { closePortfolioModal(); fetchPortfolio(); }
      else { const err = await res.json(); await showAlert(err.error || 'Failed to save project', { title: 'Error' }); }
    } catch (err) { console.error(err); await showAlert('An error occurred.', { title: 'Error' }); }
  };
  const deleteProject = async (id) => {
    const confirmed = await showConfirm('Are you sure you want to delete this project?', { title: 'Delete Project', confirmLabel: 'Delete' });
    if (!confirmed) return;
    try {
      await fetch(`/api/portfolio/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
      fetchPortfolio();
    } catch (err) { console.error(err); }
  };

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
      if (source === 'facebook') return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0&width=560&autoplay=true`;
    } catch { /* ignore */ }
    return url;
  };
  const getYoutubeThumbnail = (url) => {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
    if (!match) return null;
    const id = match[1];
    const rawUrl = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    const API_BASE = import.meta.env.VITE_API_URL || '';
    return `${API_BASE}/api/proxy-image?url=${encodeURIComponent(rawUrl)}`;
  };
  const getProjectPoster = (proj) => {
    if (brokenThumbs[proj.id]) return null;
    if (proj.thumbnail_url) return resolveMediaUrl(proj.thumbnail_url);
    if (proj.poster_url) return resolveMediaUrl(proj.poster_url);
    return getYoutubeThumbnail(proj.media_link) || null;
  };

  // ── Experience helpers & CRUD ─────────────────────────────────────
  const fetchExperiences = async () => {
    try {
      const res = await fetch('/api/experience', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) setExperiences(await res.json());
    } catch (err) { console.error(err); }
  };

  const openExpEdit = (exp) => {
    setEditingExpId(exp.id);
    setExpForm({
      title: exp.title || '', organization: exp.organization || '',
      experience_type: exp.experience_type || 'Film',
      start_date: exp.start_date || '', end_date: exp.end_date || '',
      description: exp.description || ''
    });
    setShowExpModal(true);
  };
  const closeExpModal = () => { setShowExpModal(false); setEditingExpId(null); setExpForm(expInitialForm); };
  const handleExpSubmit = async (e) => {
    e.preventDefault();
    try {
      const url = editingExpId ? `/api/experience/${editingExpId}` : '/api/experience';
      const method = editingExpId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(expForm)
      });
      if (res.ok) { closeExpModal(); fetchExperiences(); }
    } catch (err) { console.error(err); await showAlert(editingExpId ? 'Failed to update experience' : 'Failed to add experience', { title: 'Error' }); }
  };
  const deleteExperience = async (id) => {
    const confirmed = await showConfirm('Are you sure you want to delete this experience?', { title: 'Delete Experience', confirmLabel: 'Delete' });
    if (!confirmed) return;
    try {
      await fetch(`/api/experience/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
      fetchExperiences();
    } catch (err) { console.error(err); }
  };
  const getExperienceIcon = (type) => {
    switch(type) {
      case 'Film': return <Film size={20} />;
      case 'Jury': return <Scale size={20} />;
      case 'Curator': return <Users size={20} />;
      case 'Teaching': return <GraduationCap size={20} />;
      case 'Writing': return <Pencil size={20} />;
      case 'Distribution': return <Clapperboard size={20} />;
      case 'Cultural': return <Globe size={20} />;
      case 'Workshop': return <BookOpen size={20} />;
      case 'Award': return <Award size={20} />;
      case 'Education': return <GraduationCap size={20} />;
      default: return <Briefcase size={20} />;
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
      showAlert('Failed to save and upload image. Please try again.', { title: 'Upload Failed' });
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ margin: 0, display: 'inline-block' }}>Gender</label>
                <PrivacySelector isTeacher={profile?.role === "instructor"}
                  fieldName="gender"
                  currentValue={privacySettings.gender}
                  onChange={handlePrivacyChange}
                  compact
                />
              </div>
              <select name="gender" value={formData.gender} onChange={handleChange} className="input-glass" style={{ appearance: 'none' }}>
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </div>
            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ margin: 0, display: 'inline-block' }}>Birthday</label>
                <PrivacySelector isTeacher={profile?.role === "instructor"}
                  fieldName="birthday"
                  currentValue={privacySettings.birthday}
                  onChange={handlePrivacyChange}
                  compact
                />
              </div>
              <input type="date" name="birthday" value={formData.birthday} onChange={handleChange} className="input-glass" />
            </div>
            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ margin: 0, display: 'inline-block' }}>Present Address</label>
                <PrivacySelector isTeacher={profile?.role === "instructor"}
                  fieldName="present_address"
                  currentValue={privacySettings.present_address}
                  onChange={handlePrivacyChange}
                  compact
                />
              </div>
              <input type="text" name="present_address" value={formData.present_address} onChange={handleChange} className="input-glass" placeholder="Current living address" />
            </div>
            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ margin: 0, display: 'inline-block' }}>Permanent Address</label>
                <PrivacySelector isTeacher={profile?.role === "instructor"}
                  fieldName="permanent_address"
                  currentValue={privacySettings.permanent_address}
                  onChange={handlePrivacyChange}
                  compact
                />
              </div>
              <input type="text" name="permanent_address" value={formData.permanent_address} onChange={handleChange} className="input-glass" placeholder="Permanent home address" />
            </div>
            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ margin: 0, display: 'inline-block' }}>Educational Qualification</label>
                <PrivacySelector isTeacher={profile?.role === "instructor"}
                  fieldName="educational_qualification"
                  currentValue={privacySettings.educational_qualification}
                  onChange={handlePrivacyChange}
                  compact
                />
              </div>
              <input type="text" name="educational_qualification" value={formData.educational_qualification} onChange={handleChange} className="input-glass" placeholder="Highest degree or current study" />
            </div>
            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ margin: 0, display: 'inline-block' }}>Profession</label>
                <PrivacySelector isTeacher={profile?.role === "instructor"}
                  fieldName="profession"
                  currentValue={privacySettings.profession}
                  onChange={handlePrivacyChange}
                  compact
                />
              </div>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ margin: 0, display: 'inline-block' }}>Mobile Number</label>
                <PrivacySelector isTeacher={profile?.role === "instructor"}
                  fieldName="mobile_number"
                  currentValue={privacySettings.mobile_number}
                  onChange={handlePrivacyChange}
                  compact
                />
              </div>
              <div className="input-wrapper">
                <Phone size={18} className="input-icon" />
                <input type="tel" name="mobile_number" value={formData.mobile_number} onChange={handleChange} className="input-glass" placeholder="+880..." />
              </div>
            </div>
            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ margin: 0, display: 'inline-block' }}>WhatsApp Number</label>
                <PrivacySelector isTeacher={profile?.role === "instructor"}
                  fieldName="whatsapp_number"
                  currentValue={privacySettings.whatsapp_number}
                  onChange={handlePrivacyChange}
                  compact
                />
              </div>
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
                <label style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Social Links</label>
                <PrivacySelector isTeacher={profile?.role === "instructor"}
                  fieldName="social_links"
                  currentValue={privacySettings.social_links}
                  onChange={handlePrivacyChange}
                  compact
                />
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
                    onClick={async () => {
                      const invalidLink = socialLinks.find(link => !validateSocialLink(link.platform, link.url));
                      if (invalidLink) {
                        await showAlert(`The link "${invalidLink.url}" does not match the selected platform (${invalidLink.platform}). Please select the correct platform or choose 'Other'.`, { title: 'Invalid Link' });
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 className="font-display" style={{ margin: 0 }}>About Me (Bio)</h3>
            <PrivacySelector isTeacher={profile?.role === "instructor"}
              fieldName="bio"
              currentValue={privacySettings.bio}
              onChange={handlePrivacyChange}
            />
          </div>
          <textarea 
            name="bio" 
            value={formData.bio} 
            onChange={handleChange} 
            className="input-glass" 
            placeholder="Tell the community about your filmmaking interests..." 
            style={{ minHeight: '120px', padding: '1rem', resize: 'vertical', width: '100%' }}
          />
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2rem', marginBottom: '3rem' }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Save size={18} /> {saving ? 'Saving Changes...' : 'Save Profile Changes'}
          </button>
        </div>
      </form>

        {/* ── Portfolio Section ─────────────────────────────────────── */}
        <section className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Video size={20} className="text-secondary" /> Portfolio
              <PrivacySelector isTeacher={profile?.role === "instructor"}
                fieldName="portfolio"
                currentValue={privacySettings.portfolio}
                onChange={handlePrivacyChange}
                compact
              />
            </h3>
            <button onClick={() => { setEditingProject(null); setPortfolioForm(portfolioInitialForm); setCredits([]); setAwards([]); setShowPortfolioModal(true); }} className="btn btn-glass" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}>
              <Plus size={14} /> Add Project
            </button>
          </div>

          {projects.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.015)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.08)' }}>
              <Video size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>No projects yet. Click <strong>Add Project</strong> to start building your portfolio.</p>
            </div>
          ) : (
            <div className="profile-portfolio-grid">
              {projects.map(proj => (
                <div key={proj.id} className="profile-portfolio-card glass-panel">
                  <div className="pf-card-media">
                    {proj.awards?.length > 0 && <div className="pf-achievement-badge"><Award size={14} /></div>}
                    {proj.media_link ? (
                      <div className="pf-video-wrapper">
                        {playingProjectId === proj.id ? (
                          <iframe src={getEmbedUrl(proj.media_link, proj.media_source)} frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
                        ) : (
                          <div className="pf-thumb" onClick={() => setPlayingProjectId(proj.id)}>
                            {getProjectPoster(proj) ? (
                              <img src={getProjectPoster(proj)} alt={proj.title} onError={() => setBrokenThumbs(prev => ({...prev, [proj.id]: true}))} />
                            ) : (
                              <div className="pf-thumb-blank"><Video size={36} opacity={0.3} /></div>
                            )}
                            <div className="pf-play-overlay"><Play size={36} fill="white" /></div>
                          </div>
                        )}
                      </div>
                    ) : getProjectPoster(proj) ? (
                      <div className="pf-poster"><img src={getProjectPoster(proj)} alt={proj.title} onError={() => setBrokenThumbs(prev => ({...prev, [proj.id]: true}))} /></div>
                    ) : (
                      <div className="pf-thumb-blank"><Video size={36} opacity={0.3} /></div>
                    )}
                    <div className="pf-overlay">
                      <div className="pf-overlay-actions">
                        <button className="pf-icon-btn" onClick={() => openPortfolioEdit(proj)} style={{ color: '#60a5fa' }}><Pencil size={16} /></button>
                        <button className="pf-icon-btn" onClick={() => deleteProject(proj.id)} style={{ color: 'var(--danger)' }}><Trash2 size={16} /></button>
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
                      <h4 className="font-display" style={{ margin: 0, fontSize: '1rem' }}>{proj.title}</h4>
                      {proj.duration && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>{proj.duration}</span>}
                    </div>
                    {proj.synopsis && <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{proj.synopsis}</p>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                      {proj.credits?.slice(0, 2).map((c, i) => (
                        <span key={i} style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', color: 'var(--text-secondary)' }}><strong>{c.role}:</strong> {c.name}</span>
                      ))}
                      {proj.credits?.length > 2 && <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', color: 'var(--text-muted)' }}>+{proj.credits.length - 2} more</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Portfolio Modal ──────────────────────────────────────── */}
        {showPortfolioModal && (
          <div className="modal-overlay" onClick={closePortfolioModal}>
            <div className="modal-content glass-panel" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="font-display">{editingProject ? 'Edit Portfolio Project' : 'Add Portfolio Project'}</h2>
                <button onClick={closePortfolioModal} className="close-btn"><X size={24} /></button>
              </div>
              <div className="modal-body custom-scrollbar">
                <form id="portfolioForm" onSubmit={handlePortfolioSubmit}>
                  <section className="form-section">
                    <h4 className="section-title">Basic Information</h4>
                    <div className="grid-2">
                      <div className="input-group">
                        <label>Project Title *</label>
                        <input type="text" value={portfolioForm.title} onChange={e => setPortfolioForm({...portfolioForm, title: e.target.value})} className="input-glass" required />
                      </div>
                      <div className="grid-2">
                        <div className="input-group">
                          <label>Duration / Length</label>
                          <input type="text" value={portfolioForm.duration} onChange={e => setPortfolioForm({...portfolioForm, duration: e.target.value})} className="input-glass" placeholder="e.g. 15 min" />
                        </div>
                        <div className="input-group">
                          <label>Genre</label>
                          <input type="text" value={portfolioForm.genre} onChange={e => setPortfolioForm({...portfolioForm, genre: e.target.value})} className="input-glass" placeholder="Documentary, Drama..." />
                        </div>
                      </div>
                    </div>
                    <div className="input-group">
                      <label>Short Synopsis</label>
                      <textarea value={portfolioForm.synopsis} onChange={e => setPortfolioForm({...portfolioForm, synopsis: e.target.value})} className="input-glass" rows={3}></textarea>
                    </div>
                  </section>
                  <section className="form-section">
                    <h4 className="section-title">Media & Links</h4>
                    <div className="grid-2">
                      <div className="input-group">
                        <label>Media Player Source</label>
                        <select value={portfolioForm.media_source} onChange={e => setPortfolioForm({...portfolioForm, media_source: e.target.value})} className="input-glass" style={{ appearance: 'none' }}>
                          <option value="youtube">YouTube</option>
                          <option value="vimeo">Vimeo</option>
                          <option value="facebook">Facebook Video</option>
                          <option value="other">Other Link</option>
                        </select>
                      </div>
                      <div className="input-group">
                        <label>Video URL / Link *</label>
                        <input type="url" value={portfolioForm.media_link} onChange={e => setPortfolioForm({...portfolioForm, media_link: e.target.value})} className="input-glass" placeholder="https://youtube.com/..." required />
                      </div>
                    </div>
                    <div className="input-group">
                      <label>Poster Image URL (Optional Thumbnail)</label>
                      <input type="url" value={portfolioForm.poster_url} onChange={e => setPortfolioForm({...portfolioForm, poster_url: e.target.value})} className="input-glass" placeholder="Leave empty to auto-fetch from video if possible" />
                    </div>
                  </section>
                  <section className="form-section">
                    <h4 className="section-title">Cast & Crew Credits</h4>
                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                      <select value={creditRole} onChange={e => setCreditRole(e.target.value)} className="input-glass" style={{ flex: 1, appearance: 'none' }}>
                        {portfolioRoleOptions.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <input type="text" value={creditName} onChange={e => setCreditName(e.target.value)} className="input-glass" placeholder="Name" style={{ flex: 2 }} />
                      <button type="button" onClick={addCredit} className="btn btn-glass">Add</button>
                    </div>
                    <div className="tag-cloud">
                      {credits.map((c, i) => (
                        <div key={i} className="credit-tag"><strong>{c.role}:</strong> {c.name}<X size={14} className="remove-icon" onClick={() => removeCredit(i)} /></div>
                      ))}
                      {credits.length === 0 && <span className="text-muted text-sm">No credits added yet.</span>}
                    </div>
                  </section>
                  <section className="form-section">
                    <h4 className="section-title"><Award size={16} style={{ display: 'inline', verticalAlign: 'middle' }}/> Awards (Optional)</h4>
                    <div className="grid-3" style={{ marginBottom: '1rem', alignItems: 'end' }}>
                      <div className="input-group">
                        <label>Award Name/Category</label>
                        <input type="text" value={awardData.awardName} onChange={e => setAwardData({...awardData, awardName: e.target.value})} className="input-glass" placeholder="Best Director" />
                      </div>
                      <div className="input-group">
                        <label>Festival Name</label>
                        <input type="text" value={awardData.festivalName} onChange={e => setAwardData({...awardData, festivalName: e.target.value})} className="input-glass" placeholder="Dhaka Int. Film Fest" />
                      </div>
                      <div className="input-group" style={{ display: 'flex', gap: '0.5rem' }}>
                        <div style={{ flex: 1 }}>
                          <label>Year</label>
                          <input type="text" value={awardData.awardYear} onChange={e => setAwardData({...awardData, awardYear: e.target.value})} className="input-glass" placeholder="2024" />
                        </div>
                        <button type="button" onClick={addAward} className="btn btn-glass" style={{ alignSelf: 'flex-end', height: '42px' }}>Add</button>
                      </div>
                    </div>
                    <div className="tag-cloud">
                      {awards.map((a, i) => (
                        <div key={i} className="award-tag"><Award size={14} /> {a.awardName} ({a.awardYear})<X size={14} className="remove-icon" onClick={() => removeAward(i)} /></div>
                      ))}
                    </div>
                  </section>
                  <section className="form-section">
                    <h4 className="section-title">Visibility & Distribution</h4>
                    <div className="grid-2 toggle-grid">
                      <label className="toggle-label">
                        <span>Show on my Dashboard</span>
                        <input type="checkbox" checked={portfolioForm.show_on_dashboard} onChange={e => setPortfolioForm({...portfolioForm, show_on_dashboard: e.target.checked})} />
                      </label>
                      <label className="toggle-label">
                        <span>Publish to Institute Community</span>
                        <input type="checkbox" checked={portfolioForm.show_on_community} onChange={e => setPortfolioForm({...portfolioForm, show_on_community: e.target.checked})} />
                      </label>
                    </div>
                    <div className="input-group" style={{ marginTop: '1.5rem' }}>
                      <label>External Privacy Access</label>
                      <select value={portfolioForm.privacy_setting} onChange={e => setPortfolioForm({...portfolioForm, privacy_setting: e.target.value})} className="input-glass" style={{ appearance: 'none', width: '250px' }}>
                        <option value="public">Public (Anyone can view)</option>
                        <option value="unlisted">Unlisted (Link only)</option>
                        <option value="private">Private (Only me & Admins)</option>
                      </select>
                    </div>
                  </section>
                </form>
              </div>
              <div className="modal-footer">
                <button onClick={closePortfolioModal} className="btn btn-glass">Cancel</button>
                <button form="portfolioForm" type="submit" className="btn btn-primary">{editingProject ? 'Save Changes' : 'Publish Project'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Work & Cultural Experience Section ────────────────────────────── */}
        <section className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 className="font-display" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Briefcase size={20} className="text-secondary" /> Work & Cultural Experience
              <PrivacySelector isTeacher={profile?.role === "instructor"}
                fieldName="experiences"
                currentValue={privacySettings.experiences}
                onChange={handlePrivacyChange}
                compact
              />
            </h3>
            <button onClick={() => { setEditingExpId(null); setExpForm(expInitialForm); setShowExpModal(true); }} className="btn btn-glass" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}>
              <Plus size={14} /> Add Experience
            </button>
          </div>

          {experiences.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.015)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.08)' }}>
              <Briefcase size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>No experiences added yet. Click <strong>Add Experience</strong> to get started.</p>
            </div>
          ) : (
            <div className="exp-inline-timeline">
              {experiences.map((exp, idx) => (
                <div key={idx} className="exp-inline-card">
                  <div className="exp-inline-icon">{getExperienceIcon(exp.experience_type)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '1rem' }}>{exp.title}</h4>
                        <p style={{ margin: '0.1rem 0 0', color: 'var(--accent-primary)', fontSize: '0.85rem', fontWeight: 500 }}>{exp.organization}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: '20px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{exp.experience_type}</span>
                        <button onClick={() => openExpEdit(exp)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.3rem', borderRadius: '6px', display: 'flex', alignItems: 'center', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none'; }}><Pencil size={14} /></button>
                        <button onClick={() => deleteExperience(exp.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.3rem', borderRadius: '6px', display: 'flex', alignItems: 'center', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none'; }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: exp.description ? '0.5rem' : 0 }}>
                      <Calendar size={12} />
                      {exp.end_date ? `${exp.start_date || 'N/A'} — ${exp.end_date}` : (exp.start_date || 'N/A')}
                    </div>
                    {exp.description && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{exp.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Experience Modal ─────────────────────────────────────── */}
        {showExpModal && (
          <div className="modal-overlay" onClick={closeExpModal}>
            <div className="modal-content glass-panel" style={{ maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="font-display">{editingExpId ? 'Edit Experience' : 'Add Experience'}</h2>
                <button onClick={closeExpModal} className="close-btn"><X size={24} /></button>
              </div>
              <div className="modal-body">
                <form id="expForm" onSubmit={handleExpSubmit}>
                  <div className="input-group">
                    <label>Title / Role *</label>
                    <input type="text" value={expForm.title} onChange={e => setExpForm({...expForm, title: e.target.value})} className="input-glass" placeholder="e.g. Lead Director, Production Assistant" required />
                  </div>
                  <div className="input-group">
                    <label>Organization / Project Name</label>
                    <input type="text" value={expForm.organization} onChange={e => setExpForm({...expForm, organization: e.target.value})} className="input-glass" placeholder="e.g. BFI Film Workshop, Netflix Production" />
                  </div>
                  <div className="grid-2">
                    <div className="input-group">
                      <label>Experience Type</label>
                      <select 
                        value={standardTypes.includes(expForm.experience_type) ? expForm.experience_type : 'Other'} 
                        onChange={e => {
                          const val = e.target.value;
                          if (val === 'Other') {
                            setExpForm({...expForm, experience_type: ''});
                          } else {
                            setExpForm({...expForm, experience_type: val});
                          }
                        }} 
                        className="input-glass" 
                        style={{ appearance: 'none' }}
                      >
                        <option value="Film">Film Production</option>
                        <option value="Jury">Jury / Committee</option>
                        <option value="Curator">Curator / Programmer</option>
                        <option value="Teaching">Teaching / Mentorship</option>
                        <option value="Writing">Screenwriting & Film Criticism</option>
                        <option value="Distribution">Distribution & Exhibition</option>
                        <option value="Cultural">Cultural Activity</option>
                        <option value="Workshop">Workshop / Course</option>
                        <option value="Award">Achievement / Award</option>
                        <option value="Education">Education</option>
                        <option value="Other">Other (Custom Type)</option>
                      </select>
                    </div>
                    
                    {!standardTypes.includes(expForm.experience_type) && (
                      <div className="input-group">
                        <label>Custom Experience Type *</label>
                        <input 
                          type="text" 
                          value={expForm.experience_type} 
                          onChange={e => setExpForm({...expForm, experience_type: e.target.value})} 
                          className="input-glass" 
                          placeholder="e.g. Costume Design, Voice Acting" 
                          required 
                        />
                      </div>
                    )}
                  </div>
                  <div className="grid-2">
                    <div className="input-group">
                      <label>Start Date</label>
                      <input type="text" value={expForm.start_date} onChange={e => setExpForm({...expForm, start_date: e.target.value})} className="input-glass" placeholder="e.g. Jan 2023 or 2009" />
                    </div>
                    <div className="input-group">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label>End Date</label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                          <input 
                            type="checkbox" 
                            checked={expForm.end_date === 'Present'} 
                            onChange={e => {
                              setExpForm({
                                ...expForm, 
                                end_date: e.target.checked ? 'Present' : ''
                              });
                            }} 
                          />
                          Ongoing
                        </label>
                      </div>
                      <input 
                        type="text" 
                        value={expForm.end_date === 'Present' ? '' : expForm.end_date} 
                        onChange={e => setExpForm({...expForm, end_date: e.target.value})} 
                        className="input-glass" 
                        placeholder="e.g. Dec 2023 (leave empty for single event)" 
                        disabled={expForm.end_date === 'Present'} 
                      />
                    </div>
                  </div>
                  <div className="input-group">
                    <label>Description / Key Contributions</label>
                    <textarea value={expForm.description} onChange={e => setExpForm({...expForm, description: e.target.value})} className="input-glass" rows={4} placeholder="Describe your role and what you achieved..."></textarea>
                  </div>
                </form>
              </div>
              <div className="modal-footer">
                <button onClick={closeExpModal} className="btn btn-glass">Cancel</button>
                <button form="expForm" type="submit" className="btn btn-primary">{editingExpId ? 'Update Experience' : 'Save Experience'}</button>
              </div>
            </div>
          </div>
        )}
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

      /* ── Inline Portfolio Grid ─────────────────────────── */
      .profile-portfolio-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1.25rem;
      }
      .profile-portfolio-card {
        border-radius: 14px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--glass-border);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
      }
      .profile-portfolio-card:hover { transform: translateY(-4px); box-shadow: 0 12px 30px rgba(0,0,0,0.4); }
      .pf-card-media { position: relative; aspect-ratio: 16/9; background: #000; overflow: hidden; }
      .pf-achievement-badge { position: absolute; top: 0.6rem; left: 0.6rem; background: linear-gradient(135deg, var(--warning) 0%, #d97706 100%); color: white; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; z-index: 10; }
      .pf-video-wrapper, .pf-video-wrapper iframe { width: 100%; height: 100%; border: none; }
      .pf-thumb { position: relative; width: 100%; height: 100%; cursor: pointer; overflow: hidden; background: #000; display: flex; align-items: center; justify-content: center; }
      .pf-thumb img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
      .pf-thumb:hover img { transform: scale(1.05); }
      .pf-thumb-blank { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: var(--bg-surface-2); color: var(--text-muted); }
      .pf-poster img { width: 100%; height: 100%; object-fit: cover; }
      .pf-play-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; transition: background 0.3s ease; }
      .pf-thumb:hover .pf-play-overlay { background: rgba(0,0,0,0.5); }
      .pf-play-overlay svg { color: white; filter: drop-shadow(0 0 12px rgba(239,68,68,0.6)); transition: transform 0.3s ease; }
      .pf-thumb:hover .pf-play-overlay svg { transform: scale(1.15); }
      .pf-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 50%); opacity: 0; transition: opacity 0.3s ease; display: flex; align-items: flex-end; justify-content: flex-end; padding: 0.75rem; z-index: 5; pointer-events: none; }
      .profile-portfolio-card:hover .pf-overlay { opacity: 1; }
      .pf-overlay-actions { pointer-events: auto; display: flex; gap: 0.4rem; }
      .pf-icon-btn { width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.12); backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.2); color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s; }
      .pf-icon-btn:hover { background: rgba(255,255,255,0.25); }

      /* ── Inline Experience Timeline ────────────────────── */
      .exp-inline-timeline { display: flex; flex-direction: column; gap: 1rem; }
      .exp-inline-card {
        display: flex; gap: 1rem; padding: 1rem;
        background: rgba(255,255,255,0.02); border-radius: 12px;
        border: 1px solid var(--glass-border);
        transition: all 0.25s ease;
      }
      .exp-inline-card:hover { background: rgba(255,255,255,0.04); border-color: var(--accent-primary); }
      .exp-inline-icon {
        width: 42px; height: 42px; flex-shrink: 0;
        background: var(--accent-primary); border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        color: white; box-shadow: 0 6px 16px rgba(0,0,0,0.3);
      }

      /* ── Shared modal styles ─────────────────────────────────── */

      /* Dark mode: navy glass backdrop identical to the app panels */
      .modal-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100vh;
        background: rgba(1, 4, 13, 0.85);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        display: flex; align-items: center; justify-content: center;
        z-index: 1000; padding: 2rem;
      }
      .modal-content {
        width: 100%; max-width: 800px; max-height: 90vh;
        display: flex; flex-direction: column;
        background: linear-gradient(160deg, rgba(9, 20, 38, 0.98) 0%, rgba(3, 11, 25, 0.99) 100%);
        border-radius: 20px;
        border: 1px solid rgba(96, 165, 250, 0.18);
        box-shadow:
          0 0 0 1px rgba(96, 165, 250, 0.15),
          0 0 24px rgba(96, 165, 250, 0.10),
          0 24px 64px rgba(0, 0, 0, 0.7);
        animation: profileModalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @keyframes profileModalIn {
        from { opacity: 0; transform: scale(0.97) translateY(12px); }
        to   { opacity: 1; transform: scale(1)    translateY(0);     }
      }
      .modal-header {
        padding: 1.5rem 2rem;
        border-bottom: 1px solid rgba(96, 165, 250, 0.12);
        display: flex; justify-content: space-between; align-items: center;
        background: rgba(96, 165, 250, 0.04);
        border-top-left-radius: 20px; border-top-right-radius: 20px;
      }
      .modal-header h2 { color: var(--text-primary); font-size: 1.3rem; }
      .close-btn {
        background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
        color: var(--text-secondary); cursor: pointer;
        width: 34px; height: 34px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.2s;
      }
      .close-btn:hover { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.3); color: #f87171; }
      .modal-body {
        padding: 2rem; overflow-y: auto; flex: 1;
        color: var(--text-primary);
      }
      .modal-footer {
        padding: 1.25rem 2rem;
        border-top: 1px solid rgba(96, 165, 250, 0.12);
        display: flex; justify-content: flex-end; gap: 1rem;
        background: rgba(96, 165, 250, 0.04);
        border-bottom-left-radius: 20px; border-bottom-right-radius: 20px;
      }
      .form-section { margin-bottom: 2.5rem; }
      .section-title {
        font-size: 1rem; font-weight: 600;
        color: var(--text-secondary);
        margin-bottom: 1rem;
        padding-bottom: 0.6rem;
        border-bottom: 1px solid rgba(96, 165, 250, 0.12);
        letter-spacing: 0.02em;
      }
      .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
      .grid-3 { display: grid; grid-template-columns: 2fr 2fr 1fr; gap: 1rem; }
      .text-sm { font-size: 0.85rem; }
      .tag-cloud { display: flex; flex-wrap: wrap; gap: 0.5rem; min-height: 32px; }
      .credit-tag, .award-tag {
        display: flex; align-items: center; gap: 0.5rem;
        padding: 0.35rem 0.75rem;
        background: rgba(96, 165, 250, 0.08);
        border: 1px solid rgba(96, 165, 250, 0.2);
        border-radius: 20px; font-size: 0.83rem;
        color: var(--text-primary);
      }
      .award-tag { background: rgba(245,158,11,0.1); border-color: rgba(245,158,11,0.3); color: #fcd34d; }
      .remove-icon { cursor: pointer; opacity: 0.55; transition: opacity 0.2s; margin-left: 2px; }
      .remove-icon:hover { opacity: 1; color: var(--danger); }
      .toggle-grid {
        background: rgba(96, 165, 250, 0.04);
        padding: 1rem; border-radius: 10px;
        border: 1px solid rgba(96, 165, 250, 0.12);
      }
      .toggle-label { display: flex; justify-content: space-between; align-items: center; cursor: pointer; }

      /* ── Light mode modal overrides ───────────────────────────── */
      [data-mode="light"] .modal-overlay {
        background: rgba(15, 23, 42, 0.5) !important;
        backdrop-filter: blur(8px) !important;
      }
      [data-mode="light"] .modal-content {
        background: #ffffff !important;
        border: 1px solid rgba(14, 165, 233, 0.15) !important;
        box-shadow: 0 8px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.06) !important;
      }
      [data-mode="light"] .modal-header {
        background: #f8fafc !important;
        border-bottom-color: rgba(0,0,0,0.07) !important;
      }
      [data-mode="light"] .modal-header h2 { color: #0f172a !important; }
      [data-mode="light"] .close-btn {
        background: rgba(0,0,0,0.05) !important;
        border-color: rgba(0,0,0,0.1) !important;
        color: #64748b !important;
      }
      [data-mode="light"] .close-btn:hover {
        background: rgba(239,68,68,0.08) !important;
        color: #dc2626 !important;
      }
      [data-mode="light"] .modal-body { color: #0f172a !important; }
      [data-mode="light"] .modal-footer {
        background: #f8fafc !important;
        border-top-color: rgba(0,0,0,0.07) !important;
      }
      [data-mode="light"] .section-title {
        color: #334155 !important;
        border-bottom-color: rgba(0,0,0,0.07) !important;
      }
      [data-mode="light"] .credit-tag {
        background: rgba(14,165,233,0.06) !important;
        border-color: rgba(14,165,233,0.2) !important;
        color: #0f172a !important;
      }
      [data-mode="light"] .toggle-grid {
        background: #f8fafc !important;
        border-color: rgba(0,0,0,0.07) !important;
      }
      [data-mode="light"] .toggle-label { color: #0f172a !important; }
    `}</style>
    </>
  );
}
