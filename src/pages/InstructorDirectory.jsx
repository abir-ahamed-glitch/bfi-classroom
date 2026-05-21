import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SkeletonLoader from '../components/SkeletonLoader';
import { Mail, Award } from 'lucide-react';
import { resolveMediaUrl } from '../utils/mediaUtils';
import './Registry.css';

export default function InstructorDirectory() {
  const navigate = useNavigate();
  const [teachersList, setTeachersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchTeachers = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/registry/teachers', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setTeachersList(data.teachers || []);
      } catch (err) {
        console.error('Error fetching teachers:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTeachers();
  }, []);

  const handleStartChat = (teacher) => {
    navigate('/inbox', { state: { selectedUser: teacher } });
  };

  return (
    <div className="page-container container registry-page">
      <div className="registry-header" style={{ marginBottom: '2rem' }}>
        <div className="registry-header-content">
          <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
            Instructor Directory
          </h1>
          <p className="subtitle">
            Browse our esteemed instructors and reach out to them.
          </p>
        </div>
      </div>

      <div className="registry-content">
        {loading ? (
          <div className="registry-loader"><SkeletonLoader variant="grid" count={6} /></div>
        ) : error ? (
          <div className="registry-error glass-panel">{error}</div>
        ) : (
          <div className="instructor-directory-section">
            {teachersList.length > 0 ? (
              <div className="students-grid">
                {teachersList.map(teacher => (
                  <div key={teacher.id} className="student-card glass-panel dashboard-highlight-outline" style={{ borderTop: '3px solid var(--primary-color)' }}>
                    <div className="student-avatar-wrapper" onClick={() => navigate(`/profile/${teacher.id}`)}>
                      <img 
                        src={teacher.profile_picture ? resolveMediaUrl(teacher.profile_picture) : `${import.meta.env.BASE_URL}avatars/male1.png`} 
                        alt={teacher.first_name} 
                        className="student-avatar"
                      />
                    </div>
                    <h3 className="student-name" onClick={() => navigate(`/profile/${teacher.id}`)}>
                      {teacher.first_name} {teacher.last_name}
                    </h3>
                    <div className="student-meta">
                      <span className="batch-badge" style={{ background: 'var(--accent-primary)', color: 'white' }}>
                        <Award size={12} style={{ marginRight: '4px' }} />
                        Instructor
                      </span>
                    </div>
                    {teacher.subjects && teacher.subjects.length > 0 && (
                      <div className="instructor-subjects" style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        <p style={{ fontWeight: '500' }}>Subjects:</p>
                        <p>{teacher.subjects.join(', ')}</p>
                      </div>
                    )}
                    <button className="btn btn-primary" style={{ width: '100%', marginTop: 'auto' }} onClick={(e) => {
                      e.stopPropagation();
                      handleStartChat(teacher);
                    }}>
                      <Mail size={14} /> Message
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state glass-panel">
                <Award size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                <p>No instructors found.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
