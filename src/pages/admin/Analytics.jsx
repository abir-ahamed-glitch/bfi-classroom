import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  FunnelChart, Funnel, LabelList, Cell,
  PieChart, Pie,
  LineChart, Line, Area, AreaChart,
} from 'recharts';
import {
  AlertTriangle, Users, CheckCircle, Clock, FileText, BarChart2,
  RefreshCw, Award, UserPlus, Megaphone, FileSpreadsheet,
  TrendingUp, GraduationCap, Film, CreditCard, Activity,
  UserX, BookOpen, ShieldCheck, Search, X, ChevronRight,
} from 'lucide-react';
import './Analytics.css';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = '/api/analytics';

async function apiFetch(endpoint) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function timeAgo(timestamp) {
  if (!timestamp) return 'Unknown time';
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatCurrency(n) {
  if (!n) return '৳0';
  return '৳' + n.toLocaleString('en-BD');
}

// ─────────────────────────────────────────────────────────────────────────────
const STAT_DRAWERS = {
  'students/all': {
    title: 'All Registered Students',
    subtitle: 'Every registered student account',
    columns: [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
      ['gender', 'Gender'],
      ['registration_date', 'Registration Date'],
    ],
  },
  'students/admitted': {
    title: 'Admitted Students - Phase 1',
    subtitle: 'Students admitted into Phase 1',
    columns: [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
      ['admitted_date', 'Admitted Date'],
    ],
  },
  'students/enrolled': {
    title: 'Currently Enrolled Students',
    subtitle: 'Students with an active course enrollment',
    columns: [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
      ['course_name', 'Course'],
      ['enrolled_date', 'Enrolled Date'],
    ],
  },
  'students/passed-exam': {
    title: 'Students Who Passed Phase 1 Exam',
    subtitle: 'Students who successfully passed the Phase 1 exam',
    columns: [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
      ['exam_score', 'Exam Score'],
      ['pass_date', 'Pass Date'],
    ],
  },
  'students/failed-exam': {
    title: 'Students Who Did Not Pass',
    subtitle: 'Registered students who have not passed the Phase 1 exam',
    columns: [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
      ['course_name', 'Course'],
      ['registration_date', 'Registered Date'],
    ],
  },
  'students/completed-phase1': {
    title: 'Students Who Completed Phase 1',
    subtitle: 'Students who completed all Phase 1 requirements',
    columns: [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
      ['completion_date', 'Completion Date'],
    ],
  },
  'students/completed-phase2': {
    title: 'Students Who Completed Phase 2',
    subtitle: 'Students who completed Phase 2',
    columns: [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
      ['completion_date', 'Completion Date'],
    ],
  },
  'students/submitted-film': {
    title: 'Students Who Submitted Their Film',
    subtitle: 'Students who submitted their assignment or film',
    columns: [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
      ['submission_date', 'Submission Date'],
    ],
  },
  'students/certificates-issued': {
    title: 'Certificates Issued',
    subtitle: 'Students whose course certificates have been issued',
    columns: [
      ['name', 'Student Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
      ['course_name', 'Course'],
      ['issued_date', 'Issued Date'],
    ],
  },
};

const DATE_DRAWER_FIELDS = new Set([
  'registration_date',
  'admitted_date',
  'enrolled_date',
  'pass_date',
  'completion_date',
  'submission_date',
  'issued_date',
]);

// Skeleton loader for cards
// ─────────────────────────────────────────────────────────────────────────────
function CardSkeleton({ count = 4, height = 100 }) {
  return (
    <div className="analytics-skeleton-row">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="analytics-skeleton-card" style={{ height }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity Feed Icon resolver
// ─────────────────────────────────────────────────────────────────────────────
function ActivityIcon({ type, color }) {
  const style = {
    width: 34, height: 34, borderRadius: 9,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    background: `${color}1a`,
    color,
  };
  switch (type) {
    case 'student_registered': return <div style={style}><UserPlus size={16} /></div>;
    case 'certificate_issued':  return <div style={style}><Award size={16} /></div>;
    case 'bulk_import':         return <div style={style}><FileSpreadsheet size={16} /></div>;
    case 'announcement':        return <div style={style}><Megaphone size={16} /></div>;
    default:                    return <div style={style}><Activity size={16} /></div>;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Tooltip for Charts
// ─────────────────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(1,4,13,0.95)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '10px',
      padding: '0.6rem 0.9rem',
      fontSize: '0.78rem',
      backdropFilter: 'blur(10px)',
    }}>
      {label && <p style={{ color: 'rgba(255,255,255,0.6)', margin: '0 0 0.4rem', fontWeight: 600 }}>{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} style={{ margin: '0.1rem 0', color: entry.color || '#fff', fontWeight: 600 }}>
          {entry.name}: <span style={{ color: '#fff' }}>{entry.value}</span>
        </p>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function Analytics() {
  const [urgent, setUrgent]           = useState(null);
  const [stats, setStats]             = useState(null);
  const [batchData, setBatchData]     = useState(null);
  const [funnelData, setFunnelData]   = useState(null);
  const [feeData, setFeeData]         = useState(null);
  const [loginData, setLoginData]     = useState(null);
  const [activity, setActivity]       = useState(null);
  const [unreadReports, setUnreadReports] = useState(0);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError]             = useState(null);
  const activityTimerRef              = useRef(null);
  const navigate                      = useNavigate();

  // ── Drawer States ──────────────────────────────────────────
  const [activeDrawer, setActiveDrawer] = useState(null); // 'pending-certificates' | 'inactive-students' | 'failed-students' | 'missing-attendance' | 'unpaid-students' | null
  const [drawerData, setDrawerData] = useState([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState('');
  const [drawerSearch, setDrawerSearch] = useState('');

  // Fetch drawer details on open
  useEffect(() => {
    if (!activeDrawer) {
      setDrawerData([]);
      setDrawerSearch('');
      return;
    }

    const fetchDrawerData = async () => {
      setDrawerLoading(true);
      setDrawerError('');
      try {
        const data = await apiFetch(`/${activeDrawer}`);
        setDrawerData(data);
      } catch (err) {
        console.error(`[Analytics] Error fetching drawer ${activeDrawer}:`, err);
        setDrawerError('Failed to load detail data. Please check your credentials or backend server status.');
      } finally {
        setDrawerLoading(false);
      }
    };

    fetchDrawerData();
  }, [activeDrawer]);

  useEffect(() => {
    if (!activeDrawer) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape') setActiveDrawer(null);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [activeDrawer]);

  const handleIssueCertificate = async (userId, enrollmentId) => {
    if (!window.confirm('Are you sure you want to issue the certificate for this student?')) {
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/students/${userId}/progress`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          course_id: enrollmentId,
          step4_completed: 1
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to issue certificate');
      }
      // Re-fetch drawer data
      const data = await apiFetch(`/${activeDrawer}`);
      setDrawerData(data);
      // Re-fetch dashboard stats silently
      fetchAll(true);
    } catch (err) {
      alert(err.message);
    }
  };


  // ── Fetch all data ─────────────────────────────────────────
  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const [u, s, b, f, fee, l, a, reportCount] = await Promise.all([
        apiFetch('/urgent'),
        apiFetch('/stats'),
        apiFetch('/students-per-batch'),
        apiFetch('/funnel'),
        apiFetch('/fee-status'),
        apiFetch('/login-activity'),
        apiFetch('/recent-activity'),
        fetch('/api/reports/admin/unread-count', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        }).then(async (response) => {
          if (!response.ok) throw new Error(`API error: ${response.status}`);
          return response.json();
        }),
      ]);
      setUrgent(u);
      setStats(s);
      setBatchData(b);
      setFunnelData(f);
      setFeeData(fee);
      setLoginData(l);
      setActivity(a);
      setUnreadReports(Number(reportCount.count || 0));
      setLastUpdated(new Date());
    } catch (err) {
      console.error('[Analytics] fetch error:', err);
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ── Activity auto-refresh every 60 seconds ─────────────────
  const fetchActivity = useCallback(async () => {
    try {
      const a = await apiFetch('/recent-activity');
      setActivity(a);
    } catch (err) {
      console.error('[Analytics] activity refresh error:', err);
    }
  }, []);

  const getDrawerTitle = () => {
    if (STAT_DRAWERS[activeDrawer]) return STAT_DRAWERS[activeDrawer].title;
    switch (activeDrawer) {
      case 'pending-certificates': return 'Certificates Pending Auto-Issuance';
      case 'inactive-students': return 'Inactive Students';
      case 'failed-students': return 'Failed / Did Not Pass Exam';
      case 'missing-attendance': return 'Missing Phase 2 Attendance';
      case 'unpaid-students': return 'Unpaid Students';
      default: return 'Detail List';
    }
  };

  const getDrawerSubtitle = () => {
    if (STAT_DRAWERS[activeDrawer]) return STAT_DRAWERS[activeDrawer].subtitle;
    switch (activeDrawer) {
      case 'pending-certificates': return 'Eligible students with no certificate issued yet';
      case 'inactive-students': return 'Students with no login activity in the last 30 days';
      case 'failed-students': return 'Registered students who have not yet passed the Phase 1 Exam';
      case 'missing-attendance': return 'Filmmaking students who are missing phase 2 shooting or editing attendance';
      case 'unpaid-students': return 'Students with outstanding unpaid fee statuses';
      default: return '';
    }
  };

  const filteredDrawerData = drawerData.filter(row => {
    const term = drawerSearch.toLowerCase().trim();
    if (!term) return true;
    const name = (row.name || `${row.first_name || ''} ${row.last_name || ''}`).toLowerCase();
    const id = (row.student_id || '').toLowerCase();
    return name.includes(term) || id.includes(term);
  });

  const statisticsDrawer = STAT_DRAWERS[activeDrawer];

  const renderStatisticsCell = (row, field) => {
    if (field === 'name') {
      return row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'N/A';
    }
    if (field === 'exam_score') {
      return row[field] != null ? row[field] : 'N/A';
    }
    if (DATE_DRAWER_FIELDS.has(field)) {
      return row[field] ? new Date(row[field]).toLocaleDateString() : 'N/A';
    }
    return row[field] || 'N/A';
  };

  useEffect(() => {
    fetchAll();

    activityTimerRef.current = setInterval(() => {
      fetchActivity();
    }, 60000);

    return () => {
      if (activityTimerRef.current) clearInterval(activityTimerRef.current);
    };
  }, [fetchAll, fetchActivity]);

  const handleRefresh = () => {
    fetchAll(true);
  };

  // ── Format last updated ────────────────────────────────────
  const lastUpdatedStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  // ─────────────────────────────────────────────────────────
  return (
    <div className="analytics-page">
      {/* ── Page Header ── */}
      <div className="analytics-page-header">
        <div className="analytics-title-group">
          <h1><BarChart2 size={22} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.4rem', color: '#60a5fa' }} /> Analytics Dashboard</h1>
          <p>Read-only overview of institute-wide data and student progress.</p>
        </div>
        <div className="analytics-header-actions">
          <span className="analytics-last-updated">Last updated: {lastUpdatedStr}</span>
          <button
            className={`analytics-refresh-btn${refreshing ? ' spinning' : ''}`}
            onClick={handleRefresh}
            disabled={refreshing}
            id="analytics-refresh-btn"
          >
            <RefreshCw size={14} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="analytics-error-banner" style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '12px',
          padding: '1rem',
          marginBottom: '1.5rem',
          color: '#f87171',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '0.88rem',
          backdropFilter: 'blur(4px)'
        }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, color: '#f87171' }} />
          <div>
            <strong style={{ fontWeight: 600 }}>Error loading dashboard data:</strong> {error}. 
            {error.includes('401') || error.includes('403') 
              ? ' Your login session has expired (likely due to a backend server restart). Please log out and log back in to refresh your access.' 
              : ' Please refresh the page or check the backend server connection.'}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          SECTION 1 — Urgent Action Cards
      ═══════════════════════════════════════════════════════ */}
      <div className="analytics-section">
        <p className="analytics-section-title"><AlertTriangle size={13} /> Urgent Actions</p>
        {loading ? (
          <CardSkeleton count={4} height={110} />
        ) : (
          <div className="urgent-cards-row">
            {/* Certificates Pending Auto-Issuance */}
            <div
              id="urgent-card-pending-certs"
              className={`urgent-card danger${urgent?.pendingCertApprovals > 0 ? ' has-items' : ''}`}
              onClick={() => setActiveDrawer('pending-certificates')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setActiveDrawer('pending-certificates')}
            >
              <div className="urgent-card-icon"><CheckCircle size={20} /></div>
              <div className="urgent-card-count">{urgent?.pendingCertApprovals ?? 0}</div>
              <div className="urgent-card-label">Certificates Pending Auto-Issuance</div>
              <div className="urgent-card-sublabel">Eligible students with no certificate issued yet</div>
            </div>

            {/* Missing Phase 2 Attendance */}
            <div
              id="urgent-card-missing-attendance"
              className={`urgent-card warning${urgent?.missingAttendance > 0 ? ' has-items' : ''}`}
              onClick={() => setActiveDrawer('missing-attendance')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setActiveDrawer('missing-attendance')}
            >
              <div className="urgent-card-icon"><Users size={20} /></div>
              <div className="urgent-card-count">{urgent?.missingAttendance ?? 0}</div>
              <div className="urgent-card-label">Missing Attendance</div>
              <div className="urgent-card-sublabel">Phase 2 not yet recorded</div>
            </div>

            {/* Inactive Students */}
            <div
              id="urgent-card-inactive-students"
              className={`urgent-card danger${urgent?.inactiveStudents > 0 ? ' has-items' : ''}`}
              onClick={() => setActiveDrawer('inactive-students')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setActiveDrawer('inactive-students')}
            >
              <div className="urgent-card-icon"><Clock size={20} /></div>
              <div className="urgent-card-count">{urgent?.inactiveStudents ?? 0}</div>
              <div className="urgent-card-label">Inactive Students</div>
              <div className="urgent-card-sublabel">No login in past 30 days</div>
            </div>

            {/* Unread Reports — placeholder */}
            <div
              id="urgent-card-unread-reports"
              className={`urgent-card danger${unreadReports > 0 ? ' has-items' : ''}`}
              onClick={() => navigate('/admin/reports?status=pending')}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && navigate('/admin/reports?status=pending')}
            >
              <div className="urgent-card-icon"><FileText size={20} /></div>
              <div className="urgent-card-count">{unreadReports}</div>
              <div className="urgent-card-label">Unread Reports</div>
              <div className="urgent-card-sublabel">Pending moderation review</div>
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
          SECTION 2 — Overall Institute Statistics
      ═══════════════════════════════════════════════════════ */}
      <div className="analytics-section">
        <p className="analytics-section-title"><TrendingUp size={13} /> Institute Statistics</p>
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1rem' }}>
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="analytics-skeleton-card" style={{ height: 76 }} />
            ))}
          </div>
        ) : (
          <div className="stats-grid">
            <StatCard icon={<Users size={18} />} iconVariant="blue" value={stats?.totalRegistered} label="Total Registered Students" active={activeDrawer === 'students/all'} onClick={() => setActiveDrawer('students/all')} />
            <StatCard icon={<UserPlus size={18} />} iconVariant="sky" value={stats?.totalAdmitted} label="Total Admitted (Phase 1)" active={activeDrawer === 'students/admitted'} onClick={() => setActiveDrawer('students/admitted')} />
            <StatCard icon={<BookOpen size={18} />} iconVariant="blue" value={stats?.currentlyEnrolled} label="Currently Enrolled" active={activeDrawer === 'students/enrolled'} onClick={() => setActiveDrawer('students/enrolled')} />
            <StatCard icon={<ShieldCheck size={18} />} iconVariant="green" value={stats?.passedPhase1Exam} label="Passed Phase 1 Exam" active={activeDrawer === 'students/passed-exam'} onClick={() => setActiveDrawer('students/passed-exam')} />
            <StatCard icon={<UserX size={18} />} iconVariant="red" value={stats?.failedOrDropped} label="Failed / Did Not Pass" active={activeDrawer === 'students/failed-exam'} onClick={() => setActiveDrawer('students/failed-exam')} />
            <StatCard icon={<GraduationCap size={18} />} iconVariant="amber" value={stats?.completedPhase1} label="Completed Phase 1" active={activeDrawer === 'students/completed-phase1'} onClick={() => setActiveDrawer('students/completed-phase1')} />
            <StatCard icon={<Film size={18} />} iconVariant="amber" value={stats?.completedPhase2} label="Completed Phase 2" active={activeDrawer === 'students/completed-phase2'} onClick={() => setActiveDrawer('students/completed-phase2')} />
            <StatCard icon={<FileText size={18} />} iconVariant="purple" value={stats?.submittedFilm} label="Submitted Assignment / Film" active={activeDrawer === 'students/submitted-film'} onClick={() => setActiveDrawer('students/submitted-film')} />
            <StatCard icon={<Award size={18} />} iconVariant="green" value={stats?.certificatesIssued} label="Certificates Issued" active={activeDrawer === 'students/certificates-issued'} onClick={() => setActiveDrawer('students/certificates-issued')} />
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
          SECTION 3 — Charts
      ═══════════════════════════════════════════════════════ */}
      <div className="analytics-section">
        <p className="analytics-section-title"><BarChart2 size={13} /> Data Visualisation</p>
        <div className="charts-grid">

          {/* Chart 1 — Students per Batch (Grouped Bar) */}
          <div className="chart-card" id="chart-students-per-batch">
            <div className="chart-card-header">
              <h3 className="chart-card-title">Students per Batch</h3>
              <p className="chart-card-subtitle">Total enrolled vs. course completions</p>
            </div>
            {loading || !batchData ? (
              <div className="analytics-skeleton-card" style={{ height: 220 }} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={batchData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="batch" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }} />
                  <Bar dataKey="totalEnrolled" name="Total Enrolled" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed"     name="Completed Phase 2" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Chart 2 — Course Completion Funnel (Horizontal Bar) */}
          <div className="chart-card" id="chart-completion-funnel">
            <div className="chart-card-header">
              <h3 className="chart-card-title">Course Completion Funnel</h3>
              <p className="chart-card-subtitle">Student drop-off at each stage</p>
            </div>
            {loading || !funnelData ? (
              <div className="analytics-skeleton-card" style={{ height: 220 }} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={funnelData}
                  layout="vertical"
                  margin={{ top: 4, right: 30, left: 10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    width={90}
                    tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" name="Students" radius={[0, 4, 4, 0]}>
                    {funnelData.map((entry, index) => {
                      const colors = ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'];
                      return <Cell key={`cell-${index}`} fill={colors[index] || '#2563eb'} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Chart 3 — Fee Collection Status (Donut) */}
          <div className="chart-card" id="chart-fee-status">
            <div className="chart-card-header">
              <h3 className="chart-card-title">Fee Collection Status</h3>
              <p className="chart-card-subtitle">Paid / Partial / Unpaid breakdown</p>
            </div>
            {loading || !feeData ? (
              <div className="analytics-skeleton-card" style={{ height: 220 }} />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={feeData.slices.filter(s => s.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                      nameKey="name"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {feeData.slices.filter(s => s.value > 0).map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.color} 
                          style={{ cursor: entry.name === 'Unpaid' ? 'pointer' : 'default' }}
                          onClick={() => {
                            if (entry.name === 'Unpaid') setActiveDrawer('unpaid-students');
                          }}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="fee-pie-summary">
                  <div className="fee-pie-stat">
                    <div className="fee-pie-stat-value">{formatCurrency(feeData.collectedAmount)}</div>
                    <div className="fee-pie-stat-label">Collected</div>
                  </div>
                  <div className="fee-pie-stat" style={{ cursor: 'pointer' }} onClick={() => setActiveDrawer('unpaid-students')}>
                    <div className="fee-pie-stat-value" style={{ color: '#ef4444' }}>{formatCurrency(feeData.outstandingAmount)}</div>
                    <div className="fee-pie-stat-label">Outstanding</div>
                  </div>
                  <div className="fee-pie-stat">
                    <div className="fee-pie-stat-value">{formatCurrency(feeData.totalAmount)}</div>
                    <div className="fee-pie-stat-label">Total Expected</div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Chart 4 — Login Activity (Area/Line) */}
          <div className="chart-card" id="chart-login-activity">
            <div className="chart-card-header">
              <h3 className="chart-card-title">Student Login Activity</h3>
              <p className="chart-card-subtitle">Unique logins per day — last 30 days</p>
            </div>
            {loading || !loginData ? (
              <div className="analytics-skeleton-card" style={{ height: 220 }} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={loginData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="loginGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval={4}
                  />
                  <YAxis
                    tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => Math.round(v)}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="logins"
                    name="Logins"
                    stroke="#2563eb"
                    strokeWidth={2}
                    fill="url(#loginGradient)"
                    dot={false}
                    activeDot={{ r: 4, fill: '#60a5fa' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          SECTION 4 — Recent Activity Feed
      ═══════════════════════════════════════════════════════ */}
      <div className="analytics-section">
        <p className="analytics-section-title"><Activity size={13} /> Recent Activity</p>
        <div className="activity-section">
          <div className="activity-feed-card" id="activity-feed">
            <div className="activity-feed-header">
              <h3 className="activity-feed-title">
                <span className="activity-live-dot" />
                Live Activity Feed
              </h3>
              <span className="activity-feed-subtitle">Auto-refreshes every 60 seconds</span>
            </div>
            {loading || !activity ? (
              <div style={{ padding: '1rem' }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="analytics-skeleton-card" style={{ height: 52, marginBottom: '0.6rem', borderRadius: 10 }} />
                ))}
              </div>
            ) : activity.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem' }}>
                No recent activity to display.
              </div>
            ) : (
              <ul className="activity-feed-list">
                {activity.map((item, i) => (
                  <li key={i} className="activity-feed-item">
                    <ActivityIcon type={item.type} color={item.color} />
                    <div className="activity-feed-body">
                      <div className="activity-feed-desc">{item.description}</div>
                      <div className="activity-feed-time">{timeAgo(item.timestamp)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Drawer Overlay */}
      <div 
        className={`analytics-drawer-overlay${activeDrawer ? ' active' : ''}`}
        onClick={() => setActiveDrawer(null)}
      />

      {/* Slide-In Drawer */}
      <div className={`analytics-drawer${activeDrawer ? ' active' : ''}`}>
        <div className="analytics-drawer-header">
          <div className="analytics-drawer-title-group">
            <h2>{getDrawerTitle()}</h2>
            <p>{getDrawerSubtitle()}</p>
          </div>
          <button className="analytics-drawer-close" onClick={() => setActiveDrawer(null)}>
            <X size={20} />
          </button>
        </div>

        <div className="analytics-drawer-content">
          <div className="analytics-drawer-actions">
            <div className="analytics-drawer-search-wrapper">
              <Search size={16} />
              <input
                type="text"
                className="analytics-drawer-search-input"
                placeholder="Search by student name or ID..."
                value={drawerSearch}
                onChange={e => setDrawerSearch(e.target.value)}
              />
            </div>
            <div className="analytics-drawer-count">
              Showing {filteredDrawerData.length} {filteredDrawerData.length === 1 ? 'student' : 'students'}
            </div>
          </div>

          {drawerLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="analytics-skeleton-card" style={{ height: 52, borderRadius: 10 }} />
              ))}
            </div>
          ) : drawerError ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#f87171', fontSize: '0.9rem' }}>
              {drawerError}
            </div>
          ) : filteredDrawerData.length === 0 ? (
            <div className="analytics-drawer-empty">
              <UserX size={48} className="analytics-drawer-empty-icon" />
              <div className="analytics-drawer-empty-text">
                {activeDrawer === 'pending-certificates'
                  ? 'All eligible students have their certificates — nothing pending.'
                  : 'No students found'}
              </div>
            </div>
          ) : (
            <div className="analytics-drawer-table-container">
              {statisticsDrawer ? (
                <table className="analytics-drawer-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      {statisticsDrawer.columns.map(([field, label]) => (
                        <th key={field}>{label}</th>
                      ))}
                      <th style={{ textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDrawerData.map((row, index) => (
                      <tr key={row.enrollment_id || row.user_id}>
                        <td>{index + 1}</td>
                        {statisticsDrawer.columns.map(([field]) => (
                          <td
                            key={field}
                            style={field === 'name' ? { fontWeight: '500', color: 'var(--text-primary)' } : undefined}
                          >
                            {renderStatisticsCell(row, field)}
                          </td>
                        ))}
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="analytics-table-action-btn"
                            onClick={() => navigate(`/profile/${row.user_id}`)}
                          >
                            View Profile
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
              <table className="analytics-drawer-table">
                <thead>
                  <tr>
                    {activeDrawer === 'pending-certificates' ? (
                      <>
                        <th>Student Name</th>
                        <th>Student ID</th>
                      </>
                    ) : (
                      <>
                        <th>Student ID</th>
                        <th>Name</th>
                      </>
                    )}
                    {activeDrawer === 'pending-certificates' && (
                      <>
                        <th>Batch</th>
                        <th>Course</th>
                        <th>Phase 2 Completed</th>
                        <th>Payment Status</th>
                        <th style={{ textAlign: 'center' }}>Actions</th>
                      </>
                    )}
                    {activeDrawer === 'inactive-students' && (
                      <>
                        <th>Batch</th>
                        <th>Last Login</th>
                        <th>Days Inactive</th>
                        <th style={{ textAlign: 'center' }}>Actions</th>
                      </>
                    )}
                    {activeDrawer === 'failed-students' && (
                      <>
                        <th>Batch</th>
                        <th>Enrolled Course</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'center' }}>Actions</th>
                      </>
                    )}
                    {activeDrawer === 'missing-attendance' && (
                      <>
                        <th>Batch</th>
                        <th style={{ textAlign: 'center' }}>Shooting</th>
                        <th style={{ textAlign: 'center' }}>Editing</th>
                        <th style={{ textAlign: 'center' }}>Actions</th>
                      </>
                    )}
                    {activeDrawer === 'unpaid-students' && (
                      <>
                        <th>Batch</th>
                        <th>Phase 1 Fee</th>
                        <th>Phase 2 Fee</th>
                        <th>Total Due</th>
                        <th style={{ textAlign: 'center' }}>Actions</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredDrawerData.map(row => (
                    <tr key={row.enrollment_id || row.user_id}>
                      {activeDrawer === 'pending-certificates' ? (
                        <>
                          <td style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                            {row.first_name} {row.last_name}
                          </td>
                          <td>{row.student_id}</td>
                        </>
                      ) : (
                        <>
                          <td>{row.student_id}</td>
                          <td style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
                            {row.first_name} {row.last_name}
                          </td>
                        </>
                      )}
                      {activeDrawer === 'pending-certificates' && (
                        <>
                          <td>{row.batch_number || 'N/A'}</td>
                          <td>{row.course_name}</td>
                          <td>Completed ✅</td>
                          <td>{row.payment_status} ✅</td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="analytics-table-action-btn"
                              onClick={() => handleIssueCertificate(row.user_id, row.enrollment_id)}
                            >
                              Issue Certificate Now
                            </button>
                          </td>
                        </>
                      )}
                      {activeDrawer === 'inactive-students' && (
                        <>
                          <td>{row.batch_number || 'N/A'}</td>
                          <td>{row.last_login ? new Date(row.last_login).toLocaleDateString() : 'Never'}</td>
                          <td>
                            {row.last_login 
                              ? `${Math.floor((Date.now() - new Date(row.last_login).getTime()) / (1000 * 60 * 60 * 24))} days`
                              : 'Never logged in'
                            }
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="analytics-table-action-btn"
                              onClick={() => navigate('/inbox', { state: { selectedUser: { id: row.user_id, first_name: row.first_name, last_name: row.last_name, role: 'student' } } })}
                            >
                              Send Message
                            </button>
                          </td>
                        </>
                      )}
                      {activeDrawer === 'failed-students' && (
                        <>
                          <td>{row.batch_number || 'N/A'}</td>
                          <td style={{ fontSize: '0.8rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.enrolled_courses}>
                            {row.enrolled_courses || 'None'}
                          </td>
                          <td><span style={{ color: '#ef4444' }}>Did Not Pass</span></td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="analytics-table-action-btn"
                              onClick={() => navigate(`/profile/${row.user_id}`)}
                            >
                              View Profile
                            </button>
                          </td>
                        </>
                      )}
                      {activeDrawer === 'missing-attendance' && (
                        <>
                          <td>{row.batch_number || 'N/A'}</td>
                          <td style={{ textAlign: 'center' }}>{row.phase2_shooting_attended ? '✅' : '❌'}</td>
                          <td style={{ textAlign: 'center' }}>{row.phase2_editing_attended ? '✅' : '❌'}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="analytics-table-action-btn"
                              onClick={() => navigate(`/admin/students/${row.user_id}`)}
                            >
                              Update Attendance
                            </button>
                          </td>
                        </>
                      )}
                      {activeDrawer === 'unpaid-students' && (
                        <>
                          <td>{row.batch_number || 'N/A'}</td>
                          <td>{row.phase1_fee ? `${row.phase1_fee} ৳` : '0 ৳'}</td>
                          <td>{row.phase2_fee ? `${row.phase2_fee} ৳` : '0 ৳'}</td>
                          <td style={{ color: '#f87171', fontWeight: '600' }}>
                            {row.total_due ? `${row.total_due} ৳` : '0 ৳'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="analytics-table-action-btn danger"
                              onClick={() => navigate('/inbox', { state: { selectedUser: { id: row.user_id, first_name: row.first_name, last_name: row.last_name, role: 'student' } } })}
                            >
                              Send Reminder
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: StatCard
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ icon, iconVariant, value, label, onClick, active = false }) {
  return (
    <div
      className={`stat-card${onClick ? ' clickable' : ''}${active ? ' active' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <div className={`stat-card-icon ${iconVariant}`}>{icon}</div>
      <div className="stat-card-body">
        <div className="stat-card-value">{value != null ? formatNumber(value) : '—'}</div>
        <div className="stat-card-label" title={label}>{label}</div>
      </div>
      {onClick && <ChevronRight className="stat-card-chevron" size={15} aria-hidden="true" />}
    </div>
  );
}
