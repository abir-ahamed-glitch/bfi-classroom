import React, { useState, useEffect, useRef } from 'react';
import { resolveMediaUrl } from '../utils/mediaUtils';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { getOrdinalSuffix } from '../utils/formatUtils';
import { 
  Briefcase, 
  GraduationCap, 
  MapPin, 
  Phone, 
  Mail, 
  FolderGit2, 
  Award,
  Calendar,
  MessageSquare,
  Link as LinkIcon,
  Info
} from 'lucide-react';
import './UserHoverCard.css';

export default function UserHoverCard({ userId, children, className = '', style = {} }) {
  const [isOpen, setIsOpen] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(false);
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const timeoutRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchProfile = async () => {
    if (profileData || loading) return;
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/student/profile/${userId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setProfileData(data);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMouseEnter = () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsOpen(true);
      fetchProfile();
    }, 400); // Delay before showing
  };

  const handleMouseLeave = () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 300); // Delay before hiding
  };

  const handleClick = (e) => {
    e.stopPropagation();
    navigate(`/profile/${userId}`);
  };

  // Determine access level based on role
  const isFullAccess = currentUser?.role === 'admin' || currentUser?.role === 'instructor' || currentUser?.id === userId;

  const renderCardContent = () => {
    if (loading && !profileData) {
      return <div className="user-hover-card-loading"><div className="spinner"></div></div>;
    }
    
    if (!profileData) {
      return <div className="user-hover-card-error">Profile unavailable</div>;
    }

    const {
      first_name, last_name, role, profile_picture, batch_number,
      educational_qualification, profession, mobile_number, whatsapp_number, email,
      socialLinks, experiences, portfolio, bio, gender, birthday, present_address
    } = profileData;

    return (
      <>
        <div className="uhc-header">
          <div className="uhc-avatar-container">
            {profile_picture ? (
              <img src={resolveMediaUrl(profile_picture)} alt={`${first_name}`} className="uhc-avatar" />
            ) : (
              <img src={`${import.meta.env.BASE_URL}avatars/male1.png`} alt="" className="uhc-avatar placeholder" />
            )}
          </div>
          <div className="uhc-title-area">
            <h3 className="uhc-name">{first_name} {last_name}</h3>
            <div className="uhc-role">
              {role === 'admin' ? 'Admin' : role === 'instructor' ? 'Teacher' : batch_number ? `Student - ${getOrdinalSuffix(batch_number)} Batch` : 'Student'}
            </div>
            {bio && isFullAccess && <p className="uhc-bio">{bio}</p>}
          </div>
        </div>

        <div className="uhc-body custom-scrollbar">
          {/* Contact Information */}
          {(mobile_number || email || whatsapp_number) && (
            <div className="uhc-section">
              <h4 className="uhc-section-title">Contact</h4>
              {email && <div className="uhc-info-row"><Mail size={14} /> <span>{email}</span></div>}
              {mobile_number && <div className="uhc-info-row"><Phone size={14} /> <span>{mobile_number}</span></div>}
              {whatsapp_number && <div className="uhc-info-row"><Phone size={14} /> <span>WA: {whatsapp_number}</span></div>}
            </div>
          )}

          {/* Education & Profession */}
          {(educational_qualification || profession) && (
            <div className="uhc-section">
              <h4 className="uhc-section-title">Background</h4>
              {educational_qualification && <div className="uhc-info-row"><GraduationCap size={14} /> <span>{educational_qualification}</span></div>}
              {profession && <div className="uhc-info-row"><Briefcase size={14} /> <span>{profession}</span></div>}
            </div>
          )}

          {/* Portfolio & Experience Summary */}
          {((portfolio && portfolio.length > 0) || (experiences && experiences.length > 0)) && (
            <div className="uhc-section">
              <h4 className="uhc-section-title">Activity</h4>
              {portfolio && portfolio.length > 0 && <div className="uhc-info-row"><FolderGit2 size={14} /> <span>{portfolio.length} Portfolio {portfolio.length === 1 ? 'Item' : 'Items'}</span></div>}
              {experiences && experiences.length > 0 && <div className="uhc-info-row"><Award size={14} /> <span>{experiences.length} Experience {experiences.length === 1 ? 'Entry' : 'Entries'}</span></div>}
            </div>
          )}

          {/* Full Access Additional Info */}
          {isFullAccess && (gender || birthday || present_address) && (
            <div className="uhc-section uhc-full-access">
              <h4 className="uhc-section-title">Personal Details (Admin/Teacher only)</h4>
              {gender && <div className="uhc-info-row"><Info size={14} /> <span>{gender}</span></div>}
              {birthday && <div className="uhc-info-row"><Calendar size={14} /> <span>{new Date(birthday).toLocaleDateString()}</span></div>}
              {present_address && <div className="uhc-info-row"><MapPin size={14} /> <span>{present_address}</span></div>}
            </div>
          )}

          {/* Social Links */}
          {socialLinks && socialLinks.length > 0 && (
            <div className="uhc-section">
              <h4 className="uhc-section-title">Social Links</h4>
              <div className="uhc-social-links">
                {socialLinks.map(link => (
                  <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="uhc-social-link" title={link.platform} onClick={(e) => e.stopPropagation()}>
                    <LinkIcon size={14} /> {link.platform}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="uhc-footer">
          <button className="uhc-action-btn primary" onClick={(e) => { e.stopPropagation(); navigate('/inbox', { state: { selectedUser: { id: userId, first_name: profileData?.first_name || '', last_name: profileData?.last_name || '', role: profileData?.role || '', profile_picture: profileData?.profile_picture || '' } } }); }}>
            <MessageSquare size={16} /> Message
          </button>
          <button className="uhc-action-btn secondary" onClick={(e) => { e.stopPropagation(); navigate(`/profile/${userId}`); }}>
            View Profile
          </button>
        </div>
      </>
    );
  };

  return (
    <div 
      ref={wrapperRef}
      className={`user-hover-card-wrapper ${isOpen ? 'active' : ''} ${className}`} 
      style={style} 
      onMouseEnter={handleMouseEnter} 
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {children}
      {isOpen && (
        <div className="user-hover-card-popover" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          {renderCardContent()}
        </div>
      )}
    </div>
  );
}
