import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  Shield, ShieldAlert, ShieldCheck, UserPlus, Users, Check, X, 
  Settings, Clock, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, 
  Search, RefreshCw, Key, Lock, Eye, EyeOff, Sliders, FileText, CheckSquare, Square,
  Smartphone, Monitor, Trash2, ArrowRight, Copy, CheckCheck, AlertTriangle,
  BarChart3, Calendar, Filter, Activity, Archive, RotateCcw, Download
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useModal } from '../../components/BFIModal';
import './AdminManagement.css';

export default function AdminManagement() {
  const { currentUser } = useAuth();
  const { showConfirm } = useModal();

  // Active Tab: 'administrators' | 'defaults' | 'audit' | 'security'
  const [activeTab, setActiveTab] = useState('administrators');

  // Data states
  const [administrators, setAdministrators] = useState([]);
  const [catalog, setCatalog] = useState({ modules: [], allPermissions: [] });
  const [defaultPermissions, setDefaultPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [adminSubView, setAdminSubView] = useState('current'); // 'current' | 'archived'
  const [archivedAdmins, setArchivedAdmins] = useState([]);
  const [archivedSearchQuery, setArchivedSearchQuery] = useState('');

  // Archive Modal State
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveSudoPassword, setArchiveSudoPassword] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const [isArchiving, setIsArchiving] = useState(false);

  // Restore Modal State
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restoreReason, setRestoreReason] = useState('');
  const [restoreSudoPassword, setRestoreSudoPassword] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);

  // Governance Modal State (Promote / Demote Super Admin)
  const [govModal, setGovModal] = useState(null); // null | { action: 'promote' | 'demote', admin: object }
  const [govChallenge, setGovChallenge] = useState(null);
  const [govCode, setGovCode] = useState('');
  const [govRecoveryCode, setGovRecoveryCode] = useState('');
  const [govUseRecovery, setGovUseRecovery] = useState(false);
  const [govSudoPassword, setGovSudoPassword] = useState('');
  const [govError, setGovError] = useState('');
  const [isGovSubmitting, setIsGovSubmitting] = useState(false);

  // Reset Password Modal State
  const [resetTarget, setResetTarget] = useState(null);
  const [resetMethod, setResetMethod] = useState('email'); // 'email' | 'direct'
  const [resetReason, setResetReason] = useState('');
  const [resetSudoPassword, setResetSudoPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // Direct Out-of-Band Link Modal State
  const [directLinkResult, setDirectLinkResult] = useState(null);
  const [directLinkTimer, setDirectLinkTimer] = useState(1800);
  const [copiedDirectLink, setCopiedDirectLink] = useState(false);

  // Sudo Mode (Sensitive-Action Verification) State
  const [showSudoModal, setShowSudoModal] = useState(false);
  const [sudoPassword, setSudoPassword] = useState('');
  const [sudoError, setSudoError] = useState('');
  const [pendingAction, setPendingAction] = useState(null);
  const [sudoToken, setSudoToken] = useState(() => sessionStorage.getItem('sudo_token') || '');

  // Add Administrator Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    username: 'admin@',
    password: '',
    showPassword: false,
    useDefaults: true,
    selectedPermissions: []
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Permissions Modal State
  const [editAdmin, setEditAdmin] = useState(null);
  const [editPermissions, setEditPermissions] = useState([]);

  // Diff Preview Modal State
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [diffState, setDiffState] = useState(null);

  // Concurrency Conflict State
  const [concurrencyConflict, setConcurrencyConflict] = useState(null);

  // Audit Logs State (Searchable & Paginated)
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditAction, setAuditAction] = useState('all');
  const [auditLoading, setAuditLoading] = useState(false);
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);

  // Accountability Dashboard States
  const [accountabilitySummary, setAccountabilitySummary] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    rangeCount: 0,
    creators: []
  });
  const [summaryStartDate, setSummaryStartDate] = useState('');
  const [summaryEndDate, setSummaryEndDate] = useState('');
  const [summaryCreatorFilter, setSummaryCreatorFilter] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Individual Administrator Accountability Profile Modal
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileTab, setProfileTab] = useState('performed'); // 'performed' | 'received' | 'security' | 'permissions'

  // Enhanced Audit Filters
  const [auditModule, setAuditModule] = useState('all');
  const [auditOutcome, setAuditOutcome] = useState('all');
  const [auditStartDate, setAuditStartDate] = useState('');
  const [auditEndDate, setAuditEndDate] = useState('');

  // Security Tab States (MFA & Sessions)
  const [mfaStatus, setMfaStatus] = useState({ mfaEnabled: false, recoveryCodesRemaining: 0 });
  const [sessionsList, setSessionsList] = useState([]);
  const [showMfaSetupModal, setShowMfaSetupModal] = useState(false);
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [mfaVerifyCode, setMfaVerifyCode] = useState('');
  const [mfaSetupError, setMfaSetupError] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

  // MFA Replacement States
  const [showMfaReplaceModal, setShowMfaReplaceModal] = useState(false);
  const [mfaReplaceMethod, setMfaReplaceMethod] = useState('totp'); // 'totp' | 'recovery'
  const [mfaReplaceCurrentCode, setMfaReplaceCurrentCode] = useState('');
  const [mfaReplaceRecoveryCode, setMfaReplaceRecoveryCode] = useState('');
  const [mfaReplaceError, setMfaReplaceError] = useState('');

  // Helper: Get auth headers with optional Sudo token
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    const headers = { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}` 
    };
    if (sudoToken) {
      headers['X-Sudo-Token'] = sudoToken;
    }
    return headers;
  }, [sudoToken]);

  // Wrapper for sensitive API calls handling Sudo step-up authentication
  const executeWithSudo = async (actionFn) => {
    const res = await actionFn();
    if (res?.status === 428) {
      // HTTP 428: Precondition Required -> Sudo Mode required
      setPendingAction(() => actionFn);
      setShowSudoModal(true);
      return null;
    }
    return res;
  };

  // Submit Sudo Password
  const handleVerifySudo = async (e) => {
    e.preventDefault();
    if (!sudoPassword) return;
    setSudoError('');
    setIsSubmitting(true);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/auth/verify-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ password: sudoPassword })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Password verification failed');
      }

      setSudoToken(data.sudoToken);
      sessionStorage.setItem('sudo_token', data.sudoToken);
      setShowSudoModal(false);
      setSudoPassword('');

      // Retry pending action if queued
      if (pendingAction) {
        const retryFn = pendingAction;
        setPendingAction(null);
        await retryFn();
      }
    } catch (err) {
      setSudoError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };


  // Countdown timer for out-of-band direct reset link modal
  useEffect(() => {
    if (!directLinkResult) return;
    setDirectLinkTimer(1800);
    const interval = setInterval(() => {
      setDirectLinkTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [directLinkResult]);

  // Governance Action: Open Step-Up Modal and Request Challenge
  const openGovernanceModal = async (action, admin) => {
    setGovModal({ action, admin });
    setGovChallenge(null);
    setGovCode('');
    setGovRecoveryCode('');
    setGovUseRecovery(false);
    setGovSudoPassword('');
    setGovError('');
    setIsGovSubmitting(false);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/admin/super-admins/challenge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action, targetUserId: admin.id })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to issue action challenge');
      }
      setGovChallenge(data);
    } catch (err) {
      setGovError(err.message || 'Failed to prepare step-up challenge');
    }
  };

  // Governance Action: Submit Step-Up Verification
  const handleConfirmGovernance = async (e) => {
    e.preventDefault();
    if (!govModal || !govChallenge) return;
    const { action, admin } = govModal;
    setIsGovSubmitting(true);
    setGovError('');

    try {
      const token = localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      if (govSudoPassword) {
        const vRes = await fetch('/api/admin/auth/verify-password', {
          method: 'POST',
          headers,
          body: JSON.stringify({ password: govSudoPassword })
        });
        const vData = await vRes.json();
        if (!vRes.ok) throw new Error(vData.error || 'Sudo password verification failed');
        headers['X-Sudo-Token'] = vData.sudoToken;
        setSudoToken(vData.sudoToken);
        sessionStorage.setItem('sudo_token', vData.sudoToken);
      } else if (sudoToken) {
        headers['X-Sudo-Token'] = sudoToken;
      }

      const endpoint = action === 'promote' 
        ? '/api/admin/super-admins/promote' 
        : '/api/admin/super-admins/demote';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          challengeId: govChallenge.challengeId,
          challengeToken: govChallenge.challengeToken,
          code: govUseRecovery ? undefined : govCode.trim(),
          recoveryCode: govUseRecovery ? govRecoveryCode.trim() : undefined,
          targetUserId: admin.id,
          expected_version: admin.account_version || 1
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to ${action} administrator`);
      }

      setSuccessMsg(`Administrator ${admin.username} successfully ${action === 'promote' ? 'promoted to Super Admin' : 'demoted to ordinary admin'}.`);
      setGovModal(null);
      fetchData();
    } catch (err) {
      setGovError(err.message || 'Operation failed');
    } finally {
      setIsGovSubmitting(false);
    }
  };

  // Handle Archive Submission
  const handleConfirmArchive = async (e) => {
    e.preventDefault();
    if (!archiveTarget || !archiveReason.trim()) return;
    setIsArchiving(true);
    setArchiveError('');
    try {
      const token = localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      if (archiveSudoPassword) {
        const vRes = await fetch('/api/admin/auth/verify-password', {
          method: 'POST',
          headers,
          body: JSON.stringify({ password: archiveSudoPassword })
        });
        const vData = await vRes.json();
        if (!vRes.ok) throw new Error(vData.error || 'Sudo password verification failed');
        headers['X-Sudo-Token'] = vData.sudoToken;
        setSudoToken(vData.sudoToken);
        sessionStorage.setItem('sudo_token', vData.sudoToken);
      } else if (sudoToken) {
        headers['X-Sudo-Token'] = sudoToken;
      }

      const res = await fetch(`/api/admin/administrators/${archiveTarget.id}/archive`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          expected_account_version: archiveTarget.account_version || 1,
          reason: archiveReason.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to archive administrator');
      }

      setSuccessMsg(`Administrator ${archiveTarget.username} has been archived successfully.`);
      setArchiveTarget(null);
      setArchiveReason('');
      setArchiveSudoPassword('');
      fetchData();
      fetchAccountabilitySummary();
    } catch (err) {
      setArchiveError(err.message);
    } finally {
      setIsArchiving(false);
    }
  };

  // Handle Restore Submission
  const handleConfirmRestore = async (e) => {
    e.preventDefault();
    if (!restoreTarget || !restoreReason.trim()) return;
    setIsRestoring(true);
    setRestoreError('');
    try {
      const token = localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      if (restoreSudoPassword) {
        const vRes = await fetch('/api/admin/auth/verify-password', {
          method: 'POST',
          headers,
          body: JSON.stringify({ password: restoreSudoPassword })
        });
        const vData = await vRes.json();
        if (!vRes.ok) throw new Error(vData.error || 'Sudo password verification failed');
        headers['X-Sudo-Token'] = vData.sudoToken;
        setSudoToken(vData.sudoToken);
        sessionStorage.setItem('sudo_token', vData.sudoToken);
      } else if (sudoToken) {
        headers['X-Sudo-Token'] = sudoToken;
      }

      const res = await fetch(`/api/admin/administrators/${restoreTarget.id}/restore`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          expected_account_version: restoreTarget.account_version || 1,
          reason: restoreReason.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to restore administrator');
      }

      setSuccessMsg(`Administrator ${restoreTarget.username} has been restored as Inactive. Please review permissions and activate when ready.`);
      setRestoreTarget(null);
      setRestoreReason('');
      setRestoreSudoPassword('');
      fetchData();
      fetchAccountabilitySummary();
    } catch (err) {
      setRestoreError(err.message);
    } finally {
      setIsRestoring(false);
    }
  };

  // Handle Reset Password Initiation
  const handleConfirmReset = async (e) => {
    e.preventDefault();
    if (!resetTarget) return;
    setIsResetting(true);
    setResetError('');
    try {
      const token = localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      if (resetSudoPassword) {
        const vRes = await fetch('/api/admin/auth/verify-password', {
          method: 'POST',
          headers,
          body: JSON.stringify({ password: resetSudoPassword })
        });
        const vData = await vRes.json();
        if (!vRes.ok) throw new Error(vData.error || 'Sudo password verification failed');
        headers['X-Sudo-Token'] = vData.sudoToken;
        setSudoToken(vData.sudoToken);
        sessionStorage.setItem('sudo_token', vData.sudoToken);
      } else if (sudoToken) {
        headers['X-Sudo-Token'] = sudoToken;
      }

      const endpoint = resetMethod === 'email'
        ? `/api/admin/administrators/${resetTarget.id}/reset-password/email`
        : `/api/admin/administrators/${resetTarget.id}/reset-password/direct-link`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          expected_account_version: resetTarget.account_version || 1,
          reason: resetReason.trim() || 'Super Admin-initiated password reset'
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to initiate password reset');
      }

      if (resetMethod === 'email') {
        setSuccessMsg(`Password reset link dispatched to ${resetTarget.email}.`);
        setResetTarget(null);
        setResetReason('');
        setResetSudoPassword('');
        fetchData();
      } else {
        setDirectLinkResult(data);
        setCopiedDirectLink(false);
        setResetTarget(null);
        setResetReason('');
        setResetSudoPassword('');
        fetchData();
      }
    } catch (err) {
      setResetError(err.message);
    } finally {
      setIsResetting(false);
    }
  };

  // Handle Export History
  const handleExportHistory = async (adminId, format = 'csv') => {
    try {
      const token = localStorage.getItem('token');
      const headers = { 'Authorization': `Bearer ${token}` };
      if (sudoToken) headers['X-Sudo-Token'] = sudoToken;

      const res = await fetch(`/api/admin/administrators/${adminId}/export-history?format=${format}`, {
        headers
      });

      if (res.status === 428) {
        executeWithSudo(() => handleExportHistory(adminId, format));
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to export history');
      }

      if (format === 'csv') {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `admin-${adminId}-accountability-history-${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        setSuccessMsg('Accountability history exported successfully.');
      }
    } catch (err) {
      setErrorMsg(err.message);
    }
  };


  // Modal Open Handlers
  const openArchiveModal = (admin) => {
    setArchiveTarget(admin);
    setArchiveReason('');
    setArchiveSudoPassword('');
    setArchiveError('');
  };

  const openRestoreModal = (admin) => {
    setRestoreTarget(admin);
    setRestoreReason('');
    setRestoreSudoPassword('');
    setRestoreError('');
  };

  const openResetModal = (admin) => {
    setResetTarget(admin);
    setResetMethod('email');
    setResetReason('');
    setResetSudoPassword('');
    setResetError('');
  };

  const triggerExportHistory = (adminId) => {
    handleExportHistory(adminId, 'csv');
  };

  // Fetch initial data
  const fetchData = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const token = localStorage.getItem('token');
      const headers = { 'Authorization': `Bearer ${token}` };

      const [adminsRes, archivedRes, catalogRes, defaultsRes] = await Promise.all([
        fetch('/api/admin/administrators', { headers }),
        fetch('/api/admin/administrators?status=archived', { headers }),
        fetch('/api/admin/permissions/catalog', { headers }),
        fetch('/api/admin/permissions/defaults', { headers })
      ]);

      if (!adminsRes.ok) throw new Error('Failed to load administrators');
      if (!archivedRes.ok) throw new Error('Failed to load archived administrators');
      if (!catalogRes.ok) throw new Error('Failed to load permissions catalog');
      if (!defaultsRes.ok) throw new Error('Failed to load default permissions');

      const adminsData = await adminsRes.json();
      const archivedData = await archivedRes.json();
      const catalogData = await catalogRes.json();
      const defaultsData = await defaultsRes.json();

      setAdministrators(adminsData.administrators || []);
      setArchivedAdmins(archivedData.administrators || []);
      setCatalog(catalogData);
      const defaultsList = defaultsData.default_permissions || defaultsData.defaultPermissions || [];
      setDefaultPermissions(defaultsList);
      setAddForm(prev => ({
        ...prev,
        selectedPermissions: defaultsList
      }));
    } catch (err) {
      console.error('[AdminManagement] Fetch error:', err);
      setErrorMsg(err.message || 'Failed to initialize administrative console.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Searchable, Paginated Audit Logs across all operational modules
  const fetchAuditLogs = async (
    page = auditPage,
    search = auditSearch,
    action = auditAction,
    module = auditModule,
    outcome = auditOutcome,
    startDate = auditStartDate,
    endDate = auditEndDate
  ) => {
    setAuditLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: String(page),
        limit: '25',
        search: search.trim(),
        action: action
      });

      if (module && module !== 'all') params.set('module', module);
      if (outcome && outcome !== 'all') params.set('outcome', outcome);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await fetch(`/api/admin/administrators/audit-logs?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to load audit logs');
      const data = await res.json();
      setAuditLogs(data.logs || data.auditLogs || []);
      setAuditTotal(data.total || 0);
      setAuditPage(data.page || 1);
      setAuditTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error('[AdminManagement] Audit fetch error:', err);
    } finally {
      setAuditLoading(false);
    }
  };

  // Fetch Accountability Dashboard Summary KPIs & Creator Attribution
  const fetchAccountabilitySummary = async (start = summaryStartDate, end = summaryEndDate, creator = summaryCreatorFilter) => {
    setSummaryLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (start) params.set('startDate', start);
      if (end) params.set('endDate', end);
      if (creator) params.set('creatorId', creator);

      const res = await fetch(`/api/admin/administrators/accountability/summary?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAccountabilitySummary(data);
      }
    } catch (err) {
      console.error('[AdminManagement] Accountability summary fetch error:', err);
    } finally {
      setSummaryLoading(false);
    }
  };

  // Open Deep Accountability Profile Modal for an individual administrator
  const openAdminProfile = async (adminId) => {
    setShowProfileModal(true);
    setProfileLoading(true);
    setProfileTab('performed');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/admin/administrators/${adminId}/accountability-profile`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setProfileData(data);
      } else {
        setErrorMsg('Failed to load administrator accountability profile');
      }
    } catch (err) {
      console.error('[AdminManagement] Profile fetch error:', err);
    } finally {
      setProfileLoading(false);
    }
  };

  // Fetch Security (MFA & Sessions) Data
  const fetchSecurityData = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = { 'Authorization': `Bearer ${token}` };

      const [mfaRes, sessRes] = await Promise.all([
        fetch('/api/admin/mfa/status', { headers }),
        fetch('/api/admin/sessions', { headers })
      ]);

      if (mfaRes.ok) {
        const mfaData = await mfaRes.json();
        setMfaStatus(mfaData);
      }
      if (sessRes.ok) {
        const sessData = await sessRes.json();
        setSessionsList(sessData.sessions || []);
      }
    } catch (err) {
      console.error('[AdminManagement] Security fetch error:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (activeTab === 'audit') {
      fetchAuditLogs(1, auditSearch, auditAction, auditModule, auditOutcome, auditStartDate, auditEndDate);
    } else if (activeTab === 'security') {
      fetchSecurityData();
    } else if (activeTab === 'accountability') {
      fetchAccountabilitySummary();
    }
  }, [activeTab]);

  // Dependency mapping for permissions
  const dependencyMap = useMemo(() => {
    const map = {};
    (catalog.modules || []).forEach(mod => {
      (mod.permissions || []).forEach(p => {
        if (p.dependsOn) {
          map[p.id] = p.dependsOn;
        }
      });
    });
    return map;
  }, [catalog]);

  // Helper: toggle permission with auto dependency resolution
  const handlePermissionToggle = (permId, currentList, setter) => {
    const isSelected = currentList.includes(permId);
    let nextList = [...currentList];

    if (isSelected) {
      const toRemove = new Set([permId]);
      Object.entries(dependencyMap).forEach(([child, parent]) => {
        if (parent === permId) toRemove.add(child);
      });
      nextList = nextList.filter(p => !toRemove.has(p));
    } else {
      nextList.push(permId);
      const prereq = dependencyMap[permId];
      if (prereq && !nextList.includes(prereq)) {
        nextList.push(prereq);
      }
    }
    setter(nextList);
  };

  // Helper: toggle all in module
  const handleModuleToggle = (moduleObj, currentList, setter) => {
    const modPermIds = (moduleObj.permissions || []).map(p => p.id);
    const allSelected = modPermIds.every(id => currentList.includes(id));

    if (allSelected) {
      setter(currentList.filter(id => !modPermIds.includes(id)));
    } else {
      const combined = Array.from(new Set([...currentList, ...modPermIds]));
      setter(combined);
    }
  };

  // Create Administrator
  const handleCreateAdmin = async (e) => {
    e?.preventDefault();
    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    const action = async () => {
      const permsToAssign = addForm.useDefaults ? defaultPermissions : addForm.selectedPermissions;
      const res = await fetch('/api/admin/administrators', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          firstName: addForm.firstName.trim(),
          lastName: addForm.lastName.trim(),
          email: addForm.email.trim(),
          username: addForm.username.trim(),
          password: addForm.password,
          permissions: permsToAssign
        })
      });

      if (res.status === 428) return res;

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create administrator');
      }

      setSuccessMsg(`Administrator '${data.user.username}' created successfully.`);
      setShowAddModal(false);
      setAddForm({
        firstName: '',
        lastName: '',
        email: '',
        username: 'admin@',
        password: '',
        showPassword: false,
        useDefaults: true,
        selectedPermissions: defaultPermissions
      });
      fetchData();
      return res;
    };

    try {
      await executeWithSudo(action);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Prepare Diff Preview before saving permissions
  const handlePrepareDiffPreview = () => {
    if (!editAdmin) return;
    const oldPerms = editAdmin.permissions || [];
    const added = editPermissions.filter(p => !oldPerms.includes(p));
    const removed = oldPerms.filter(p => !editPermissions.includes(p));

    if (added.length === 0 && removed.length === 0) {
      setErrorMsg('No changes were made to permissions.');
      return;
    }

    setDiffState({
      admin: editAdmin,
      added,
      removed,
      newPermissions: editPermissions
    });
    setShowDiffModal(true);
  };

  // Execute Save Permissions (with Optimistic Concurrency Control)
  const handleConfirmSavePermissions = async () => {
    if (!diffState?.admin) return;
    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    setConcurrencyConflict(null);

    const action = async () => {
      const res = await fetch(`/api/admin/administrators/${diffState.admin.id}/permissions`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          permissions: diffState.newPermissions,
          expected_version: diffState.admin.permissions_version
        })
      });

      if (res.status === 428) return res;

      const data = await res.json();
      if (res.status === 409) {
        setConcurrencyConflict(data.error || 'Permissions were modified by another session.');
        setShowDiffModal(false);
        return res;
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update permissions');
      }

      setSuccessMsg(`Permissions for '${diffState.admin.username}' updated successfully.`);
      setShowDiffModal(false);
      setEditAdmin(null);
      setDiffState(null);
      fetchData();
      return res;
    };

    try {
      await executeWithSudo(action);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle Admin Status
  const handleToggleStatus = (admin) => {
    if (admin.id === 1) return;
    const actionLabel = admin.is_active ? 'deactivate' : 'activate';

    showConfirm({
      title: `${actionLabel === 'deactivate' ? 'Deactivate' : 'Activate'} Administrator`,
      message: `Are you sure you want to ${actionLabel} ${admin.username}? ${
        actionLabel === 'deactivate' 
          ? 'Their active sessions and tokens will be permanently terminated immediately.'
          : 'They will regain administrative access according to their assigned permissions.'
      }`,
      confirmLabel: actionLabel === 'deactivate' ? 'Deactivate' : 'Activate',
      isDestructive: actionLabel === 'deactivate',
      onConfirm: async () => {
        const action = async () => {
          const res = await fetch(`/api/admin/administrators/${admin.id}/status`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ is_active: admin.is_active ? 0 : 1, expected_account_version: admin.account_version || 1 })
          });

          if (res.status === 428) return res;

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to update status');

          setSuccessMsg(`Administrator ${admin.username} ${actionLabel}d successfully.`);
          fetchData();
          return res;
        };

        try {
          await executeWithSudo(action);
        } catch (err) {
          setErrorMsg(err.message);
        }
      }
    });
  };

  // Save Default Permissions
  const handleSaveDefaults = async () => {
    setIsSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    const action = async () => {
      const res = await fetch('/api/admin/permissions/defaults', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ permissions: defaultPermissions })
      });

      if (res.status === 428) return res;

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update default permissions');

      setSuccessMsg('Default administrator permissions saved successfully.');
      return res;
    };

    try {
      await executeWithSudo(action);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Start MFA Setup Flow
  const handleStartMfaSetup = async () => {
    setMfaSetupError('');
    setMfaVerifyCode('');
    setCopiedSecret(false);
    setCopiedRecovery(false);

    const action = async () => {
      const res = await fetch('/api/admin/mfa/setup', {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (res.status === 428) return res;

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to initiate MFA setup');

      setMfaSetupData(data);
      setShowMfaSetupModal(true);
      return res;
    };

    try {
      await executeWithSudo(action);
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  // Open Replace MFA Factor Prompt
  const handleOpenReplaceModal = () => {
    setMfaReplaceMethod('totp');
    setMfaReplaceCurrentCode('');
    setMfaReplaceRecoveryCode('');
    setMfaReplaceError('');
    setShowMfaReplaceModal(true);
  };

  // Authorize Replacement with Existing Factor
  const handleAuthorizeReplacement = async (e) => {
    e.preventDefault();
    setMfaReplaceError('');

    const payload = {};
    if (mfaReplaceMethod === 'totp') {
      if (!mfaReplaceCurrentCode.trim() || mfaReplaceCurrentCode.trim().length !== 6) {
        setMfaReplaceError('Please enter a valid 6-digit verification code from your current authenticator.');
        return;
      }
      payload.currentCode = mfaReplaceCurrentCode.trim();
    } else {
      if (!mfaReplaceRecoveryCode.trim()) {
        setMfaReplaceError('Please enter an unused recovery code.');
        return;
      }
      payload.recoveryCode = mfaReplaceRecoveryCode.trim();
    }

    setIsSubmitting(true);
    const action = async () => {
      const res = await fetch('/api/admin/mfa/setup', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });

      if (res.status === 428) return res;

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to authorize factor replacement');
      }

      setMfaSetupData(data);
      setShowMfaReplaceModal(false);
      setMfaVerifyCode('');
      setMfaSetupError('');
      setCopiedSecret(false);
      setCopiedRecovery(false);
      setShowMfaSetupModal(true);
      return res;
    };

    try {
      await executeWithSudo(action);
    } catch (err) {
      setMfaReplaceError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cancel MFA Setup / Replacement
  const handleCancelMfaSetup = async () => {
    try {
      if (mfaSetupData?.isReplacement) {
        await fetch('/api/admin/mfa/cancel-setup', {
          method: 'POST',
          headers: getAuthHeaders()
        });
      }
    } catch {
      // non-fatal
    } finally {
      setShowMfaSetupModal(false);
      setMfaSetupData(null);
      setMfaVerifyCode('');
      setMfaSetupError('');
    }
  };

  // Complete MFA Verification
  const handleVerifyMfaSetup = async (e) => {
    e.preventDefault();
    if (!mfaVerifyCode) return;
    setMfaSetupError('');
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/admin/mfa/verify-setup', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ code: mfaVerifyCode.trim() })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');

      if (data.isReplacement) {
        setSuccessMsg('Two-factor authentication successfully replaced. All other active sessions have been terminated for security. You remain logged in on this device.');
      } else {
        setSuccessMsg('Two-Factor Authentication successfully enabled on your account.');
      }
      setShowMfaSetupModal(false);
      setMfaSetupData(null);
      fetchSecurityData();
    } catch (err) {
      setMfaSetupError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Disable MFA
  const handleDisableMfa = () => {
    showConfirm({
      title: 'Disable Two-Factor Authentication',
      message: 'Are you sure you want to disable Two-Factor Authentication? Your account will rely only on password authentication.',
      confirmLabel: 'Disable MFA',
      isDestructive: true,
      onConfirm: async () => {
        const action = async () => {
          const res = await fetch('/api/admin/mfa/disable', {
            method: 'POST',
            headers: getAuthHeaders()
          });

          if (res.status === 428) return res;

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to disable MFA');

          setSuccessMsg('Two-Factor Authentication has been disabled.');
          fetchSecurityData();
          return res;
        };

        try {
          await executeWithSudo(action);
        } catch (err) {
          setErrorMsg(err.message);
        }
      }
    });
  };

  // Revoke a single session
  const handleRevokeSession = (sessionId) => {
    showConfirm({
      title: 'Revoke Session',
      message: 'Are you sure you want to terminate this session? The device will be immediately signed out.',
      confirmLabel: 'Revoke',
      isDestructive: true,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/admin/sessions/${sessionId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to revoke session');
          setSuccessMsg('Session terminated successfully.');
          fetchSecurityData();
        } catch (err) {
          setErrorMsg(err.message);
        }
      }
    });
  };

  // Revoke all other sessions
  const handleRevokeOtherSessions = () => {
    showConfirm({
      title: 'Revoke All Other Sessions',
      message: 'Are you sure you want to terminate all other active sessions? All other devices will be immediately signed out.',
      confirmLabel: 'Revoke All Others',
      isDestructive: true,
      onConfirm: async () => {
        try {
          const res = await fetch('/api/admin/sessions/revoke-others', {
            method: 'POST',
            headers: getAuthHeaders()
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to revoke other sessions');
          setSuccessMsg(data.message || 'Other sessions revoked.');
          fetchSecurityData();
        } catch (err) {
          setErrorMsg(err.message);
        }
      }
    });
  };

  // Filtered administrator list
  const filteredAdmins = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return administrators;
    return administrators.filter(a => 
      (a.username && a.username.toLowerCase().includes(q)) ||
      (a.email && a.email.toLowerCase().includes(q)) ||
      (a.first_name && a.first_name.toLowerCase().includes(q)) ||
      (a.last_name && a.last_name.toLowerCase().includes(q))
    );
  }, [administrators, searchQuery]);

  // Filtered archived administrator list
  const filteredArchivedAdmins = useMemo(() => {
    const q = (archivedSearchQuery || '').toLowerCase().trim();
    if (!q) return archivedAdmins;
    return archivedAdmins.filter(a => 
      (a.username && a.username.toLowerCase().includes(q)) ||
      (a.email && a.email.toLowerCase().includes(q)) ||
      (a.first_name && a.first_name.toLowerCase().includes(q)) ||
      (a.last_name && a.last_name.toLowerCase().includes(q))
    );
  }, [archivedAdmins, archivedSearchQuery]);

  const isCurrentSuperAdmin = Boolean(currentUser?.is_super_admin || currentUser?.isSuperAdmin);
  if (!isCurrentSuperAdmin) {
    return (
      <div className="admin-mgmt-container page-container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <ShieldAlert size={48} color="#ef4444" style={{ margin: '0 auto 1rem' }} />
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Access Denied</h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
          This administrative control console is restricted strictly to the Super Administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="admin-mgmt-container page-container">
      {/* Header */}
      <div className="admin-mgmt-header">
        <div className="admin-mgmt-title-group">
          <h1>
            Administrator Governance
            <span className="super-admin-crown-badge">
              <Shield size={12} /> Super Admin Console
            </span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            Manage platform administrators, configure fine-grained permissions, and audit administrative actions.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            type="button" 
            className="btn-secondary" 
            onClick={fetchData} 
            disabled={loading}
            title="Refresh administrators"
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button 
            type="button" 
            className="btn-super-primary" 
            onClick={() => {
              setAddForm(prev => ({
                ...prev,
                useDefaults: true,
                selectedPermissions: [...defaultPermissions]
              }));
              setShowAddModal(true);
            }}
          >
            <UserPlus size={18} /> New Administrator
          </button>
        </div>
      </div>

      {/* Security Banner */}
      <div className="admin-mgmt-security-banner">
        <ShieldAlert size={20} color="#e11d48" style={{ flexShrink: 0 }} />
        <div>
          <strong>Role Preservation & Security Invariant:</strong> The Super Administrator account (ID: 1, <code>admin@abir</code>) possesses inherent full access across all platform modules and cannot be demoted, deleted, or altered by ordinary administrators.
        </div>
      </div>

      {/* Alert Banners */}
      {errorMsg && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '10px',
          padding: '0.85rem 1.25rem',
          color: '#f87171',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <AlertCircle size={18} /> {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="admin-alert admin-alert-success" style={{
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '10px',
          padding: '0.85rem 1.25rem',
          color: '#34d399',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <CheckCircle2 size={18} /> {successMsg}
        </div>
      )}

      {/* Metrics Grid */}
      <div className="admin-mgmt-stats-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(225, 29, 72, 0.12)', color: '#fb7185' }}>
            <Shield size={24} />
          </div>
          <div>
            <div className="admin-stat-val">{administrators.length}</div>
            <div className="admin-stat-lbl">Total Administrators</div>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(16, 185, 129, 0.12)', color: '#34d399' }}>
            <Users size={24} />
          </div>
          <div>
            <div className="admin-stat-val">
              {administrators.filter(a => a.is_active).length}
            </div>
            <div className="admin-stat-lbl">Active Administrators</div>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(59, 130, 246, 0.12)', color: '#60a5fa' }}>
            <Sliders size={24} />
          </div>
          <div>
            <div className="admin-stat-val">{defaultPermissions.length}</div>
            <div className="admin-stat-lbl">Default Permissions</div>
          </div>
        </div>
      </div>

      {/* Nav Tabs */}
      <div className="admin-mgmt-nav-tabs">
        <button 
          type="button" 
          className={`admin-tab-btn ${activeTab === 'administrators' ? 'active' : ''}`}
          onClick={() => setActiveTab('administrators')}
        >
          <Users size={16} /> Administrators ({administrators.length + archivedAdmins.length})
        </button>
        <button 
          type="button" 
          className={`admin-tab-btn ${activeTab === 'accountability' ? 'active' : ''}`}
          onClick={() => setActiveTab('accountability')}
          data-testid="tab-accountability"
        >
          <BarChart3 size={16} /> Accountability Dashboard
        </button>
        <button 
          type="button" 
          className={`admin-tab-btn ${activeTab === 'defaults' ? 'active' : ''}`}
          onClick={() => setActiveTab('defaults')}
        >
          <Sliders size={16} /> Default Permissions
        </button>
        <button 
          type="button" 
          className={`admin-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <FileText size={16} /> Audit History
        </button>
        <button 
          type="button" 
          className={`admin-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          <Key size={16} /> Security & Sessions
        </button>
      </div>

      {/* Tab 1: Administrators List */}
      {activeTab === 'administrators' && (
        <div>
          {/* Sub-view Navigation Pills */}
          <div className="admin-subview-pills" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
            <button
              type="button"
              className={`subview-pill ${adminSubView === 'current' ? 'active' : ''}`}
              onClick={() => setAdminSubView('current')}
              data-testid="subview-current-admins"
            >
              <Users size={15} /> Current Administrators ({administrators.length})
            </button>
            <button
              type="button"
              className={`subview-pill ${adminSubView === 'archived' ? 'active' : ''}`}
              onClick={() => setAdminSubView('archived')}
              data-testid="subview-archived-admins"
            >
              <Archive size={15} /> Archived Administrators ({archivedAdmins.length})
            </button>
          </div>

          {adminSubView === 'current' ? (
            <div>
              <div className="admin-mgmt-controls">
                <div className="admin-search-input-wrap">
                  <Search size={16} className="admin-search-icon" />
                  <input 
                    type="text" 
                    placeholder="Search by name, email, or username..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Showing {filteredAdmins.length} of {administrators.length} accounts
                </div>
              </div>

              <div className="admin-table-card">
                <table className="admin-mgmt-table">
                  <thead>
                    <tr>
                      <th>Administrator</th>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Permissions</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAdmins.map((admin) => {
                      const isSuper = Boolean(admin.is_super_admin);
                      return (
                        <tr key={admin.id}>
                          <td>
                            <div className="admin-user-cell">
                              <div className={`admin-avatar-chip ${isSuper ? '' : 'ordinary'}`}>
                                {admin.first_name ? admin.first_name[0].toUpperCase() : 'A'}
                              </div>
                              <div>
                                <div className="admin-user-info-name">
                                  {admin.first_name || ''} {admin.last_name || ''}
                                  {admin.id === 1 ? (
                                    <span className="badge-super-admin" style={{ background: 'linear-gradient(135deg, rgba(225,29,72,0.2), rgba(139,92,246,0.2))', border: '1px solid rgba(225,29,72,0.4)', color: '#fb7185' }} title="Protected Founding Owner">
                                      <Shield size={10} /> Founding Owner
                                    </span>
                                  ) : isSuper ? (
                                    <span className="badge-super-admin">
                                      <Shield size={10} /> Super Admin
                                    </span>
                                  ) : (
                                    <span className="badge-ordinary-admin">Admin</span>
                                  )}
                                  {admin.password_reset_pending === 1 && (
                                    <span className="badge-reset-pending" style={{ marginLeft: '0.4rem', fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                                      Reset Pending
                                    </span>
                                  )}
                                </div>
                                <div className="admin-user-info-sub">
                                  ID: {admin.id} &bull; Joined: {admin.created_at_dhaka || new Date(admin.created_at).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td>
                            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{admin.username}</span>
                          </td>

                          <td style={{ color: 'var(--text-secondary)' }}>
                            {admin.email}
                            {admin.email_verified_at && (
                              <span title={`Verified: ${admin.email_verified_at}`} style={{ marginLeft: '0.35rem', color: '#10b981', display: 'inline-flex', verticalAlign: 'middle' }}>
                                <CheckCircle2 size={13} />
                              </span>
                            )}
                          </td>

                          <td>
                            {isSuper ? (
                              <span className="status-toggle-pill active" style={{ cursor: 'default' }}>
                                <Check size={12} /> Active (Protected)
                              </span>
                            ) : (
                              <button
                                type="button"
                                className={`status-toggle-pill ${admin.is_active ? 'active' : 'inactive'}`}
                                onClick={() => handleToggleStatus(admin)}
                                title={`Click to ${admin.is_active ? 'deactivate' : 'activate'}`}
                              >
                                {admin.is_active ? <Check size={12} /> : <X size={12} />}
                                {admin.is_active ? 'Active' : 'Inactive'}
                              </button>
                            )}
                          </td>

                          <td>
                            {isSuper ? (
                              <span style={{ fontWeight: 600, color: '#fb7185' }}>
                                Full Platform Access
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.85rem' }}>
                                <strong>{(admin.permissions || []).length}</strong> permissions granted
                              </span>
                            )}
                          </td>

                          <td>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ padding: '0.4rem 0.75rem', minHeight: '36px', fontSize: '0.8rem' }}
                                onClick={() => openAdminProfile(admin.id)}
                                data-testid={`view-profile-${admin.id}`}
                                title="View Accountability Profile"
                              >
                                <Eye size={14} /> Profile
                              </button>
                              {/* Super Admin Promotion & Demotion Actions */}
                              {admin.id === 1 ? (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '0.25rem 0.5rem' }}>
                                  Protected Founding Account
                                </span>
                              ) : isSuper ? (
                                <button
                                  type="button"
                                  className="btn-secondary btn-danger-ghost"
                                  style={{ padding: '0.4rem 0.75rem', minHeight: '36px', fontSize: '0.8rem', color: '#f43f5e' }}
                                  onClick={() => openGovernanceModal('demote', admin)}
                                  data-testid={`demote-admin-${admin.id}`}
                                  title="Demote to Ordinary Administrator"
                                >
                                  <RotateCcw size={14} /> Demote
                                </button>
                              ) : (
                                <>
                                  {admin.is_active && admin.email_verified_at && admin.two_factor_enabled ? (
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      style={{ padding: '0.4rem 0.75rem', minHeight: '36px', fontSize: '0.8rem', color: '#a855f7' }}
                                      onClick={() => openGovernanceModal('promote', admin)}
                                      data-testid={`promote-admin-${admin.id}`}
                                      title="Promote to Super Administrator"
                                    >
                                      <ShieldCheck size={14} /> Promote
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      disabled
                                      style={{ padding: '0.4rem 0.75rem', minHeight: '36px', fontSize: '0.8rem', opacity: 0.5, cursor: 'not-allowed' }}
                                      title={!admin.is_active ? "Cannot promote inactive admin" : !admin.email_verified_at ? "Promotion requires verified recovery email" : "Promotion requires enrolled Two-Factor Authentication"}
                                      data-testid={`promote-admin-disabled-${admin.id}`}
                                    >
                                      <Shield size={14} /> Promote
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    style={{ padding: '0.4rem 0.75rem', minHeight: '36px', fontSize: '0.8rem' }}
                                    onClick={() => {
                                      setEditAdmin(admin);
                                      setEditPermissions(admin.permissions || []);
                                      setConcurrencyConflict(null);
                                    }}
                                  >
                                    <Settings size={14} /> Edit Access
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    style={{ padding: '0.4rem 0.75rem', minHeight: '36px', fontSize: '0.8rem', color: '#eab308' }}
                                    onClick={() => openResetModal(admin)}
                                    data-testid={`reset-admin-${admin.id}`}
                                    title="Reset Administrator Password"
                                  >
                                    <Key size={14} /> Reset
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary btn-danger-ghost"
                                    style={{ padding: '0.4rem 0.75rem', minHeight: '36px', fontSize: '0.8rem', color: '#f43f5e' }}
                                    onClick={() => openArchiveModal(admin)}
                                    data-testid={`archive-admin-${admin.id}`}
                                    title="Archive Administrator Account"
                                  >
                                    <Archive size={14} /> Archive
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {filteredAdmins.length === 0 && (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                          No administrators found matching your query.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div>
              <div className="admin-mgmt-controls">
                <div className="admin-search-input-wrap">
                  <Search size={16} className="admin-search-icon" />
                  <input 
                    type="text" 
                    placeholder="Search archived by name, email, or username..." 
                    value={archivedSearchQuery}
                    onChange={(e) => setArchivedSearchQuery(e.target.value)}
                    data-testid="archived-search-input"
                  />
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Showing {filteredArchivedAdmins.length} of {archivedAdmins.length} archived accounts
                </div>
              </div>

              <div className="admin-table-card">
                <table className="admin-mgmt-table" data-testid="archived-admins-table">
                  <thead>
                    <tr>
                      <th>Former Administrator</th>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Archived At</th>
                      <th>Reason & Governance</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredArchivedAdmins.map((admin) => (
                      <tr key={admin.id}>
                        <td>
                          <div className="admin-user-cell">
                            <div className="admin-avatar-chip archived" style={{ opacity: 0.6 }}>
                              {admin.first_name ? admin.first_name[0].toUpperCase() : 'A'}
                            </div>
                            <div>
                              <div className="admin-user-info-name">
                                {admin.first_name || ''} {admin.last_name || ''}
                                <span className="badge-archived-admin" style={{ marginLeft: '0.4rem', fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(148, 163, 184, 0.2)', color: '#94a3b8' }}>
                                  Archived
                                </span>
                              </div>
                              <div className="admin-user-info-sub">
                                ID: {admin.id} &bull; Joined: {admin.created_at_dhaka || new Date(admin.created_at).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{admin.username}</span>
                        </td>

                        <td style={{ color: 'var(--text-secondary)' }}>
                          {admin.email}
                        </td>

                        <td style={{ fontSize: '0.85rem' }}>
                          {admin.archived_at_dhaka || (admin.archived_at ? new Date(admin.archived_at).toLocaleString() : 'N/A')}
                        </td>

                        <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          <em>{admin.archive_reason || 'No reason provided'}</em>
                        </td>

                        <td>
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '0.4rem 0.75rem', minHeight: '36px', fontSize: '0.8rem' }}
                              onClick={() => openAdminProfile(admin.id)}
                              data-testid={`view-profile-${admin.id}`}
                              title="View Accountability Profile"
                            >
                              <Eye size={14} /> Profile
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '0.4rem 0.75rem', minHeight: '36px', fontSize: '0.8rem' }}
                              onClick={() => triggerExportHistory(admin.id)}
                              data-testid={`export-history-${admin.id}`}
                              title="Export Accountability History (CSV)"
                            >
                              <Download size={14} /> Export
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-restore"
                              style={{ padding: '0.4rem 0.75rem', minHeight: '36px', fontSize: '0.8rem', color: '#10b981' }}
                              onClick={() => openRestoreModal(admin)}
                              data-testid={`restore-admin-${admin.id}`}
                              title="Restore Administrator (will be inactive)"
                            >
                              <RotateCcw size={14} /> Restore
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {filteredArchivedAdmins.length === 0 && (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                          No archived administrators found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Accountability & Governance Dashboard */}
      {activeTab === 'accountability' && (
        <div>
          {/* KPI Cards Grid */}
          <div className="accountability-grid" data-testid="accountability-kpi-grid">
            <div className="accountability-card">
              <div className="accountability-icon-wrap total">
                <Users size={24} />
              </div>
              <div>
                <div className="accountability-val" data-testid="kpi-total-admins">{accountabilitySummary.total}</div>
                <div className="accountability-lbl">Total Administrators</div>
              </div>
            </div>

            <div className="accountability-card">
              <div className="accountability-icon-wrap active">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <div className="accountability-val" data-testid="kpi-active-admins">{accountabilitySummary.active}</div>
                <div className="accountability-lbl">Active Administrators</div>
              </div>
            </div>

            <div className="accountability-card">
              <div className="accountability-icon-wrap inactive">
                <AlertCircle size={24} />
              </div>
              <div>
                <div className="accountability-val" data-testid="kpi-inactive-admins">{accountabilitySummary.inactive}</div>
                <div className="accountability-lbl">Inactive Administrators</div>
              </div>
            </div>

            <div className="accountability-card">
              <div className="accountability-icon-wrap archived" style={{ background: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8' }}>
                <Archive size={24} />
              </div>
              <div>
                <div className="accountability-val" data-testid="kpi-archived-admins">{accountabilitySummary.archived || 0}</div>
                <div className="accountability-lbl">Archived Administrators</div>
              </div>
            </div>

            <div className="accountability-card">
              <div className="accountability-icon-wrap range">
                <Calendar size={24} />
              </div>
              <div>
                <div className="accountability-val" data-testid="kpi-range-admins">{accountabilitySummary.rangeCount}</div>
                <div className="accountability-lbl">Created in Selected Range</div>
              </div>
            </div>
          </div>

          {/* Date Range & Creator Filter Controls */}
          <div className="audit-controls-bar" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>From:</span>
                <input
                  type="date"
                  className="admin-form-input"
                  style={{ width: 'auto', minHeight: '38px', padding: '0.35rem 0.65rem' }}
                  value={summaryStartDate}
                  onChange={(e) => setSummaryStartDate(e.target.value)}
                  data-testid="filter-start-date"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>To:</span>
                <input
                  type="date"
                  className="admin-form-input"
                  style={{ width: 'auto', minHeight: '38px', padding: '0.35rem 0.65rem' }}
                  value={summaryEndDate}
                  onChange={(e) => setSummaryEndDate(e.target.value)}
                  data-testid="filter-end-date"
                />
              </div>

              <select
                className="admin-form-input"
                style={{ width: 'auto', minWidth: '180px', minHeight: '38px', padding: '0.35rem 0.65rem' }}
                value={summaryCreatorFilter}
                onChange={(e) => setSummaryCreatorFilter(e.target.value)}
                data-testid="filter-creator-select"
              >
                <option value="">All Creators</option>
                <option value="legacy">Unknown / Legacy (Historical)</option>
                {(accountabilitySummary.creators || [])
                  .filter(c => c.creatorId !== null)
                  .map(c => (
                    <option key={c.creatorId} value={String(c.creatorId)}>
                      {c.creatorName} ({c.creatorUsername || `#${c.creatorId}`})
                    </option>
                  ))}
              </select>

              <button
                type="button"
                className="btn-super-primary admin-btn-primary"
                style={{ padding: '0.4rem 1rem', minHeight: '38px', fontSize: '0.85rem' }}
                onClick={() => fetchAccountabilitySummary(summaryStartDate, summaryEndDate, summaryCreatorFilter)}
                data-testid="apply-range-btn"
              >
                <Filter size={14} /> Apply Filter
              </button>

              {(summaryStartDate || summaryEndDate || summaryCreatorFilter) && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '0.4rem 0.85rem', minHeight: '38px', fontSize: '0.85rem' }}
                  onClick={() => {
                    setSummaryStartDate('');
                    setSummaryEndDate('');
                    setSummaryCreatorFilter('');
                    fetchAccountabilitySummary('', '', '');
                  }}
                >
                  Reset
                </button>
              )}
            </div>

            <button
              type="button"
              className="audit-page-btn"
              onClick={() => fetchAccountabilitySummary(summaryStartDate, summaryEndDate, summaryCreatorFilter)}
              title="Refresh Accountability Metrics"
            >
              <RefreshCw size={14} className={summaryLoading ? 'spin' : ''} /> Refresh
            </button>
          </div>

          {/* Creator Attribution Breakdown Card */}
          <div className="admin-table-card" style={{ marginBottom: '2rem' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--glass-border, rgba(255, 255, 255, 0.08))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Administrator Creation Attribution
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Historical accounts without transactional creator recorded as <em>Unknown/Legacy</em>
              </span>
            </div>

            <table className="admin-mgmt-table">
              <thead>
                <tr>
                  <th>Creator Account</th>
                  <th>Creator Identifier</th>
                  <th>Contact Email</th>
                  <th>Administrators Created</th>
                  <th>Attribution Status</th>
                </tr>
              </thead>
              <tbody>
                {(accountabilitySummary.creators || []).map((c, idx) => (
                  <tr key={c.creatorId || `legacy-${idx}`}>
                    <td>
                      <span style={{ fontWeight: 600, color: c.creatorId ? '#38bdf8' : 'var(--text-secondary)' }}>
                        {c.creatorName}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {c.creatorId ? (c.creatorUsername || `#${c.creatorId}`) : 'None'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {c.creatorEmail || '—'}
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                        {c.count}
                      </span>
                    </td>
                    <td>
                      <span className={`creator-pill ${c.creatorId ? 'named' : 'legacy'}`}>
                        {c.creatorId ? 'Verified Creator' : 'Unknown/Legacy'}
                      </span>
                    </td>
                  </tr>
                ))}

                {(accountabilitySummary.creators || []).length === 0 && (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                      No creator attribution data available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Default Permissions Configuration */}
      {activeTab === 'defaults' && (
        <div className="admin-defaults-card">
          <div className="admin-defaults-header">
            <div>
              <h2>Default Permissions for New Administrators</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                Configure the baseline access granted to future administrators when created with default permissions.
              </p>
            </div>
            <button
              type="button"
              className="btn-super-primary admin-btn-primary"
              onClick={handleSaveDefaults}
              disabled={isSubmitting}
            >
              <Check size={16} /> Save Default Permissions
            </button>
          </div>

          <div className="permission-matrix-section">
            {(catalog.modules || []).map(mod => (
              <div key={mod.id} className="permission-module-card">
                <div className="permission-module-header">
                  <div className="permission-module-title">
                    {mod.name}
                  </div>
                  <button
                    type="button"
                    style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
                    onClick={() => handleModuleToggle(mod, defaultPermissions, setDefaultPermissions)}
                  >
                    {(mod.permissions || []).every(p => defaultPermissions.includes(p.id)) ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="permission-module-items">
                  {(mod.permissions || []).map(perm => (
                    <label key={perm.id} className="permission-item-label">
                      <input
                        type="checkbox"
                        className="permission-checkbox"
                        value={perm.id}
                        checked={defaultPermissions.includes(perm.id)}
                        onChange={() => handlePermissionToggle(perm.id, defaultPermissions, setDefaultPermissions)}
                      />
                      <div className="permission-item-text">
                        <span className="permission-item-name">{perm.name}</span>
                        <span className="permission-item-desc">{perm.description}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Searchable & Paginated Audit Trail */}
      {activeTab === 'audit' && (
        <div>
          <div className="audit-controls-bar">
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', flex: 1 }}>
              <div className="admin-search-input-wrap" style={{ maxWidth: '340px' }}>
                <Search size={16} className="admin-search-icon" />
                <input 
                  type="text" 
                  placeholder="Filter logs by actor, action, details..." 
                  value={auditSearch}
                  onChange={(e) => {
                    setAuditSearch(e.target.value);
                    fetchAuditLogs(1, e.target.value, auditAction);
                  }}
                />
              </div>

              <select
                className="admin-form-input"
                style={{ width: 'auto', minWidth: '150px', minHeight: '40px', padding: '0.4rem 0.85rem' }}
                value={auditAction}
                onChange={(e) => {
                  setAuditAction(e.target.value);
                  fetchAuditLogs(1, auditSearch, e.target.value, auditModule, auditOutcome, auditStartDate, auditEndDate);
                }}
                data-testid="audit-action-filter"
              >
                <option value="all">All Actions</option>
                <option value="admin.create">admin.create</option>
                <option value="course.create">course.create</option>
                <option value="course.publish">course.publish</option>
                <option value="batch.create">batch.create</option>
                <option value="student.create">student.create</option>
                <option value="fee.update">fee.update</option>
                <option value="export.students_excel">export.students_excel</option>
                <option value="permission_denied">permission_denied</option>
                <option value="super_admin_access_denied">super_admin_access_denied</option>
              </select>

              <select
                className="admin-form-input"
                style={{ width: 'auto', minWidth: '140px', minHeight: '40px', padding: '0.4rem 0.85rem' }}
                value={auditModule}
                onChange={(e) => {
                  setAuditModule(e.target.value);
                  fetchAuditLogs(1, auditSearch, auditAction, e.target.value, auditOutcome, auditStartDate, auditEndDate);
                }}
                data-testid="audit-module-filter"
              >
                <option value="all">All Modules</option>
                <option value="admin_management">Admin Management</option>
                <option value="security">Security & Auth</option>
                <option value="courses">Courses & Maker</option>
                <option value="batches">Batches</option>
                <option value="students">Students</option>
                <option value="academic">Academic Records</option>
                <option value="fees">Fees & Finance</option>
                <option value="notices">Notices</option>
                <option value="broadcasts">Broadcasts</option>
                <option value="exports">Sensitive Exports</option>
              </select>

              <select
                className="admin-form-input"
                style={{ width: 'auto', minWidth: '130px', minHeight: '40px', padding: '0.4rem 0.85rem' }}
                value={auditOutcome}
                onChange={(e) => {
                  setAuditOutcome(e.target.value);
                  fetchAuditLogs(1, auditSearch, auditAction, auditModule, e.target.value, auditStartDate, auditEndDate);
                }}
                data-testid="audit-outcome-filter"
              >
                <option value="all">All Outcomes</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="denied">Denied</option>
              </select>
            </div>

            <div className="audit-pagination-controls">
              <span>Total: <strong>{auditTotal}</strong> logs</span>
              <button
                type="button"
                className="audit-page-btn"
                disabled={auditPage <= 1 || auditLoading}
                onClick={() => fetchAuditLogs(auditPage - 1, auditSearch, auditAction)}
              >
                Previous
              </button>
              <span>Page {auditPage} of {Math.max(1, auditTotalPages)}</span>
              <button
                type="button"
                className="audit-page-btn"
                disabled={auditPage >= auditTotalPages || auditLoading}
                onClick={() => fetchAuditLogs(auditPage + 1, auditSearch, auditAction)}
              >
                Next
              </button>
            </div>
          </div>

          <div className="admin-table-card">
            <table className="admin-mgmt-table admin-audit-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target ID</th>
                  <th>Details</th>
                  <th>IP Address</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => {
                  let badgeClass = 'update';
                  if (log.action.includes('created') || log.action.includes('create')) badgeClass = 'create';
                  if (log.action.includes('deactivated') || log.action.includes('deactivate')) badgeClass = 'deactivate';
                  if (log.action.includes('activated') || log.action.includes('activate')) badgeClass = 'activate';
                  if (log.action.includes('failed')) badgeClass = 'deactivate';

                  return (
                    <tr 
                      key={log.id} 
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedAuditLog(log)}
                      title="Click to view structured details"
                    >
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {log.dhaka_time || new Date(log.created_at).toLocaleString()}
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>
                          {log.actor_username || (log.actor_id ? `Admin #${log.actor_id}` : 'System')}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <span className={`audit-action-pill ${badgeClass}`}>
                            {log.action}
                          </span>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <span className={`module-badge module-${log.module || 'admin_management'}`}>
                              {log.module || 'admin'}
                            </span>
                            <span className={`outcome-pill outcome-${log.outcome || 'success'}`}>
                              {log.outcome || 'success'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontFamily: 'monospace' }}>
                          {log.target_user_id ? `#${log.target_user_id}` : 'Platform'}
                        </span>
                      </td>
                      <td>
                        <span 
                          className="audit-details-code" 
                          title="Click row to inspect"
                        >
                          {typeof log.details === 'object' && log.details !== null 
                            ? JSON.stringify(log.details) 
                            : (log.details || '—')}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                        {log.ip_address || '127.0.0.1'}
                      </td>
                    </tr>
                  );
                })}

                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                      No administrative audit logs match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Security & Privileged Sessions */}
      {activeTab === 'security' && (
        <div className="security-grid">
          {/* Two-Factor Authentication Card */}
          <div className="security-card">
            <div className="security-card-header">
              <div className="security-card-title">
                <Smartphone size={20} color="#e11d48" /> Two-Factor Authentication (MFA)
              </div>
              <span className={`status-toggle-pill ${mfaStatus.mfaEnabled ? 'active' : 'inactive'}`} style={{ cursor: 'default' }}>
                {mfaStatus.mfaEnabled ? <Check size={12} /> : <X size={12} />}
                {mfaStatus.mfaEnabled ? 'Enabled (Active)' : 'Not Enabled'}
              </span>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Protect privileged administrative operations with standard RFC 6238 TOTP (Google Authenticator, Microsoft Authenticator, 1Password).
            </p>

            {mfaStatus.mfaEnabled ? (
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Recovery codes remaining: <strong>{mfaStatus.recoveryCodesRemaining}</strong>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-super-primary admin-btn-primary"
                    data-testid="replace-mfa-btn"
                    onClick={handleOpenReplaceModal}
                  >
                    <Smartphone size={16} /> Change Device / Replace MFA
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    data-testid="disable-mfa-btn"
                    style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                    onClick={handleDisableMfa}
                  >
                    <Lock size={16} /> Disable Two-Factor Authentication
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  className="btn-super-primary admin-btn-primary"
                  onClick={handleStartMfaSetup}
                >
                  <Smartphone size={16} /> Enable MFA / Setup Authenticator
                </button>
              </div>
            )}
          </div>

          {/* Privileged Sessions Card */}
          <div className="security-card">
            <div className="security-card-header">
              <div className="security-card-title">
                <Monitor size={20} color="#3b82f6" /> Active Privileged Sessions
              </div>
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem', minHeight: '36px' }}
                onClick={handleRevokeOtherSessions}
                disabled={sessionsList.filter(s => !s.is_current).length === 0}
              >
                Revoke All Others
              </button>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Manage authenticated sessions currently logged into this administrator account.
            </p>

            <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
              {sessionsList.map((session) => (
                <div key={session.id} className="session-item-row">
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {session.ip_address || '127.0.0.1'}
                      {session.is_current && (
                        <span className="session-badge-current">
                          <Check size={10} /> Current Session
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      Last activity: {new Date(session.last_activity).toLocaleString()}
                    </div>
                  </div>

                  {!session.is_current && (
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '0.3rem 0.7rem', minHeight: '32px', fontSize: '0.75rem', color: '#f87171' }}
                      onClick={() => handleRevokeSession(session.id)}
                    >
                      <Trash2 size={12} /> Revoke
                    </button>
                  )}
                </div>
              ))}

              {sessionsList.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                  No active sessions found.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sudo Mode Verification Modal (Step-Up Auth) */}
      {showSudoModal && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setShowSudoModal(false)}>
          <div className="admin-modal-dialog admin-modal" style={{ maxWidth: '440px' }}>
            <div className="admin-modal-header">
              <h2><Lock size={20} color="#e11d48" /> Privileged Action Verification</h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setShowSudoModal(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleVerifySudo}>
              <div className="admin-modal-body">
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                  This sensitive administrative operation requires recent password re-authentication. Please enter your administrator password to proceed.
                </p>

                {sudoError && (
                  <div style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    color: '#f87171',
                    marginBottom: '1rem',
                    fontSize: '0.85rem'
                  }}>
                    {sudoError}
                  </div>
                )}

                <div className="admin-form-group">
                  <label className="admin-form-label">Administrator Password</label>
                  <input
                    type="password"
                    className="admin-form-input"
                    placeholder="Enter your current password"
                    value={sudoPassword}
                    onChange={(e) => setSudoPassword(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div className="admin-modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowSudoModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-super-primary" disabled={isSubmitting || !sudoPassword}>
                  Confirm & Proceed
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Permission Diff Preview Modal */}
      {showDiffModal && diffState && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setShowDiffModal(false)}>
          <div className="admin-modal-dialog admin-modal" style={{ maxWidth: '580px' }}>
            <div className="admin-modal-header">
              <h2><ShieldCheck size={20} color="#34d399" /> Review Permission Changes</h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setShowDiffModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="admin-modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                Review the exact permission adjustments for <strong>{diffState.admin.username}</strong> before saving.
              </p>

              <div className="diff-preview-container">
                {diffState.added.length > 0 && (
                  <div className="diff-section-card added">
                    <div className="diff-section-title">
                      <CheckCircle2 size={16} /> Permissions to Grant ({diffState.added.length})
                    </div>
                    <div className="diff-chips-list">
                      {diffState.added.map(p => (
                        <span key={p} className="diff-chip added">+{p}</span>
                      ))}
                    </div>
                  </div>
                )}

                {diffState.removed.length > 0 && (
                  <div className="diff-section-card removed">
                    <div className="diff-section-title">
                      <AlertCircle size={16} /> Permissions to Revoke ({diffState.removed.length})
                    </div>
                    <div className="diff-chips-list">
                      {diffState.removed.map(p => (
                        <span key={p} className="diff-chip removed">-{p}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Total permissions after update: <strong>{diffState.newPermissions.length}</strong>
                </div>
              </div>
            </div>

            <div className="admin-modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setShowDiffModal(false)}>
                Back to Editing
              </button>
              <button 
                type="button" 
                className="btn-super-primary"
                onClick={handleConfirmSavePermissions}
                disabled={isSubmitting}
              >
                <Check size={16} /> Confirm & Apply Changes
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MFA Replacement Authorization Modal */}
      {showMfaReplaceModal && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setShowMfaReplaceModal(false)}>
          <div className="admin-modal-dialog admin-modal" style={{ maxWidth: '480px' }}>
            <div className="admin-modal-header">
              <h2><Smartphone size={20} color="#e11d48" /> Authorize MFA Replacement</h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setShowMfaReplaceModal(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAuthorizeReplacement}>
              <div className="admin-modal-body">
                {mfaReplaceError && (
                  <div style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    color: '#f87171',
                    marginBottom: '1rem',
                    fontSize: '0.85rem'
                  }}>
                    {mfaReplaceError}
                  </div>
                )}

                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5, marginBottom: '1rem' }}>
                  To replace your two-factor authentication device, you must verify your identity using your existing authenticator app or an unused backup recovery code.
                </p>

                <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '1.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input
                      type="radio"
                      name="mfaReplaceMethod"
                      value="totp"
                      data-testid="replace-method-totp"
                      checked={mfaReplaceMethod === 'totp'}
                      onChange={() => setMfaReplaceMethod('totp')}
                    />
                    Authenticator Code
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input
                      type="radio"
                      name="mfaReplaceMethod"
                      value="recovery"
                      data-testid="replace-method-recovery"
                      checked={mfaReplaceMethod === 'recovery'}
                      onChange={() => setMfaReplaceMethod('recovery')}
                    />
                    Recovery Code
                  </label>
                </div>

                {mfaReplaceMethod === 'totp' ? (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                      Current Authenticator Code
                    </label>
                    <input
                      type="text"
                      className="admin-form-input"
                      placeholder="000000"
                      maxLength={6}
                      data-testid="mfa-current-code-input"
                      value={mfaReplaceCurrentCode}
                      onChange={(e) => setMfaReplaceCurrentCode(e.target.value.replace(/\D/g, ''))}
                      style={{ fontFamily: 'monospace', fontSize: '1.25rem', letterSpacing: '0.2em', textAlign: 'center' }}
                      autoFocus
                    />
                  </div>
                ) : (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                      Unused Recovery Code
                    </label>
                    <input
                      type="text"
                      className="admin-form-input"
                      placeholder="ABCDE-FGHIJ"
                      data-testid="mfa-recovery-code-input"
                      value={mfaReplaceRecoveryCode}
                      onChange={(e) => setMfaReplaceRecoveryCode(e.target.value)}
                      style={{ fontFamily: 'monospace', fontSize: '1.1rem', letterSpacing: '0.1em', textAlign: 'center' }}
                      autoFocus
                    />
                  </div>
                )}
              </div>

              <div className="admin-modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowMfaReplaceModal(false)}>
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-super-primary" 
                  data-testid="authorize-replacement-btn"
                  disabled={isSubmitting || (mfaReplaceMethod === 'totp' ? mfaReplaceCurrentCode.length !== 6 : !mfaReplaceRecoveryCode.trim())}
                >
                  Verify & Continue
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MFA Setup / Replacement Modal */}
      {showMfaSetupModal && mfaSetupData && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && handleCancelMfaSetup()}>
          <div className="admin-modal-dialog admin-modal" style={{ maxWidth: '540px' }}>
            <div className="admin-modal-header">
              <h2><Smartphone size={20} color="#e11d48" /> {mfaSetupData.isReplacement ? 'Replace Authenticator Device' : 'Set Up Two-Factor Authentication'}</h2>
              <button type="button" className="admin-modal-close-btn" onClick={handleCancelMfaSetup}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleVerifyMfaSetup}>
              <div className="admin-modal-body">
                {mfaSetupError && (
                  <div style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                    color: '#f87171',
                    marginBottom: '1rem',
                    fontSize: '0.85rem'
                  }}>
                    {mfaSetupError}
                  </div>
                )}

                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                    1. Scan QR / Enter Secret into {mfaSetupData.isReplacement ? 'New ' : ''}Authenticator App
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="text"
                      className="admin-form-input"
                      readOnly
                      data-testid="new-mfa-secret-display"
                      value={mfaSetupData.secret}
                      style={{ fontFamily: 'monospace', fontWeight: 700 }}
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        navigator.clipboard.writeText(mfaSetupData.secret);
                        setCopiedSecret(true);
                        setTimeout(() => setCopiedSecret(false), 2000);
                      }}
                      title="Copy Secret"
                    >
                      {copiedSecret ? <CheckCheck size={16} color="#34d399" /> : <Copy size={16} />}
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                    2. Save Your {mfaSetupData.isReplacement ? 'New ' : ''}Recovery Codes
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '8px' }}>
                    {mfaSetupData.isReplacement ? 'Previous recovery codes will be revoked upon completing replacement. Save these new backup codes:' : 'Save these codes in a secure password manager. If you lose access to your authenticator, each code can be used once to regain access.'}
                  </p>
                  <div className="recovery-codes-grid">
                    {mfaSetupData.recoveryCodes.map(code => (
                      <div key={code}>{code}</div>
                    ))}
                  </div>
                  <div style={{ textAlign: 'right', marginTop: '6px' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
                      onClick={() => {
                        navigator.clipboard.writeText(mfaSetupData.recoveryCodes.join('\n'));
                        setCopiedRecovery(true);
                        setTimeout(() => setCopiedRecovery(false), 2000);
                      }}
                    >
                      {copiedRecovery ? <CheckCheck size={14} color="#34d399" /> : <Copy size={14} />} Copy All Codes
                    </button>
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                    3. Enter 6-Digit Code from {mfaSetupData.isReplacement ? 'New ' : ''}Authenticator App
                  </div>
                  <input
                    type="text"
                    className="admin-form-input"
                    placeholder="000000"
                    maxLength={6}
                    data-testid="mfa-verify-code-input"
                    value={mfaVerifyCode}
                    onChange={(e) => setMfaVerifyCode(e.target.value.replace(/\D/g, ''))}
                    style={{ fontFamily: 'monospace', fontSize: '1.25rem', letterSpacing: '0.2em', textAlign: 'center' }}
                    required
                  />
                </div>
              </div>

              <div className="admin-modal-footer">
                <button type="button" className="btn-secondary" onClick={handleCancelMfaSetup}>
                  Cancel
                </button>
                <button type="submit" className="btn-super-primary" data-testid="verify-activate-mfa-btn" disabled={isSubmitting || mfaVerifyCode.length !== 6}>
                  {mfaSetupData.isReplacement ? 'Verify & Replace Authenticator' : 'Verify & Activate MFA'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Audit Log Structured Details Modal */}
      {selectedAuditLog && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setSelectedAuditLog(null)}>
          <div className="admin-modal-dialog admin-modal" style={{ maxWidth: '580px' }}>
            <div className="admin-modal-header">
              <h2><FileText size={20} color="#3b82f6" /> Audit Log Event #{selectedAuditLog.id}</h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setSelectedAuditLog(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="admin-modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.25rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Action</div>
                  <div style={{ fontWeight: 700 }}>{selectedAuditLog.action}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Timestamp</div>
                  <div>{new Date(selectedAuditLog.created_at).toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Actor</div>
                  <div>{selectedAuditLog.actor_username || `ID #${selectedAuditLog.actor_id}`}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Target User</div>
                  <div>{selectedAuditLog.target_username ? `${selectedAuditLog.target_username} (#${selectedAuditLog.target_user_id})` : (selectedAuditLog.target_user_id ? `#${selectedAuditLog.target_user_id}` : 'Platform')}</div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '6px' }}>Structured Details</div>
                <pre style={{
                  background: 'rgba(0, 0, 0, 0.4)',
                  padding: '1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.08))',
                  fontSize: '0.8rem',
                  fontFamily: 'monospace',
                  overflowX: 'auto',
                  maxHeight: '260px'
                }}>
                  {JSON.stringify(selectedAuditLog.details, null, 2)}
                </pre>
              </div>
            </div>

            <div className="admin-modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setSelectedAuditLog(null)}>
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Create Administrator */}
      {showAddModal && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}>
          <div className="admin-modal-dialog admin-modal">
            <div className="admin-modal-header">
              <h2><UserPlus size={20} color="#e11d48" /> Create New Administrator</h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setShowAddModal(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateAdmin}>
              <div className="admin-modal-body">
                <div className="admin-form-row">
                  <div className="admin-form-group">
                    <label htmlFor="admin-first-name" className="admin-form-label">First Name *</label>
                    <input
                      id="admin-first-name"
                      type="text"
                      className="admin-form-input"
                      required
                      placeholder="e.g., John"
                      value={addForm.firstName}
                      onChange={(e) => setAddForm(prev => ({ ...prev, firstName: e.target.value }))}
                    />
                  </div>

                  <div className="admin-form-group">
                    <label htmlFor="admin-last-name" className="admin-form-label">Last Name</label>
                    <input
                      id="admin-last-name"
                      type="text"
                      className="admin-form-input"
                      placeholder="e.g., Doe"
                      value={addForm.lastName}
                      onChange={(e) => setAddForm(prev => ({ ...prev, lastName: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="admin-form-row">
                  <div className="admin-form-group">
                    <label htmlFor="admin-username" className="admin-form-label">Username *</label>
                    <input
                      id="admin-username"
                      type="text"
                      className="admin-form-input"
                      required
                      placeholder="admin@john"
                      value={addForm.username}
                      onChange={(e) => setAddForm(prev => ({ ...prev, username: e.target.value }))}
                    />
                    <span className="admin-form-hint">Must start with "admin@" (e.g. admin@john)</span>
                  </div>

                  <div className="admin-form-group">
                    <label htmlFor="admin-email" className="admin-form-label">Email Address *</label>
                    <input
                      id="admin-email"
                      type="email"
                      className="admin-form-input"
                      required
                      placeholder="john@bfibd.org"
                      value={addForm.email}
                      onChange={(e) => setAddForm(prev => ({ ...prev, email: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="admin-form-group">
                  <label htmlFor="admin-password" className="admin-form-label">Initial Password *</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="admin-password"
                      type={addForm.showPassword ? 'text' : 'password'}
                      className="admin-form-input"
                      required
                      placeholder="Min 8 chars (Uppercase, lowercase, number, symbol)"
                      value={addForm.password}
                      onChange={(e) => setAddForm(prev => ({ ...prev, password: e.target.value }))}
                      style={{ paddingRight: '40px' }}
                    />
                    <button
                      type="button"
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                      onClick={() => setAddForm(prev => ({ ...prev, showPassword: !prev.showPassword }))}
                    >
                      {addForm.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <span className="admin-form-hint">Passwords are securely hashed with bcrypt (cost 10).</span>
                </div>

                {/* Permission Selection Strategy */}
                <div style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>
                  <label className="admin-form-label">Access Assignment Strategy</label>
                  <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input
                        type="radio"
                        name="accessStrategy"
                        checked={addForm.useDefaults}
                        onChange={() => setAddForm(prev => ({ ...prev, useDefaults: true }))}
                      />
                      <span>Apply default permissions ({defaultPermissions.length} selected)</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input
                        type="radio"
                        name="accessStrategy"
                        checked={!addForm.useDefaults}
                        onChange={() => setAddForm(prev => ({
                          ...prev,
                          useDefaults: false,
                          selectedPermissions: prev.selectedPermissions.length > 0 ? prev.selectedPermissions : [...defaultPermissions]
                        }))}
                      />
                      <span>Customize permissions manually</span>
                    </label>
                  </div>
                </div>

                {/* Manual Permission Matrix (if not using defaults) */}
                {!addForm.useDefaults && (
                  <div className="permission-matrix-section">
                    {(catalog.modules || []).map(mod => (
                      <div key={mod.id} className="permission-module-card">
                        <div className="permission-module-header">
                          <div className="permission-module-title">
                            {mod.name}
                          </div>
                          <button
                            type="button"
                            style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
                            onClick={() => handleModuleToggle(mod, addForm.selectedPermissions, (perms) => setAddForm(prev => ({ ...prev, selectedPermissions: perms })))}
                          >
                            {(mod.permissions || []).every(p => addForm.selectedPermissions.includes(p.id)) ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>
                        <div className="permission-module-items">
                          {(mod.permissions || []).map(perm => (
                            <label key={perm.id} className="permission-item-label">
                              <input
                                type="checkbox"
                                className="permission-checkbox"
                                value={perm.id}
                                checked={addForm.selectedPermissions.includes(perm.id)}
                                onChange={() => handlePermissionToggle(perm.id, addForm.selectedPermissions, (perms) => setAddForm(prev => ({ ...prev, selectedPermissions: perms })))}
                              />
                              <div className="permission-item-text">
                                <span className="permission-item-name">{perm.name}</span>
                                <span className="permission-item-desc">{perm.description}</span>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Effective Access Summary */}
                <div className="effective-access-box">
                  <div className="effective-access-title">
                    <ShieldCheck size={16} /> Effective Access Summary
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    The new administrator will hold <strong>{(addForm.useDefaults ? defaultPermissions : addForm.selectedPermissions).length}</strong> granted permissions:
                  </div>
                  <div className="effective-access-list">
                    {(addForm.useDefaults ? defaultPermissions : addForm.selectedPermissions).map(p => (
                      <span key={p} className="effective-access-chip">
                        {p}
                      </span>
                    ))}
                    {(addForm.useDefaults ? defaultPermissions : addForm.selectedPermissions).length === 0 && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        No operational permissions granted (Landing page and profile only).
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="admin-modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-super-primary admin-btn-primary" disabled={isSubmitting}>
                  <UserPlus size={16} /> Create Administrator
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Edit Administrator Permissions */}
      {editAdmin && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setEditAdmin(null)}>
          <div className="admin-modal-dialog admin-modal">
            <div className="admin-modal-header">
              <h2>
                <Settings size={20} color="#e11d48" /> Edit Permissions: {editAdmin.first_name} ({editAdmin.username})
              </h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setEditAdmin(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="admin-modal-body">
              {concurrencyConflict && (
                <div className="conflict-alert-box">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                    <AlertTriangle size={18} /> Concurrent Modification Conflict
                  </div>
                  <div>{concurrencyConflict}</div>
                  <div>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
                      onClick={async () => {
                        await fetchData();
                        setEditAdmin(null);
                        setConcurrencyConflict(null);
                      }}
                    >
                      Reload Latest Administrator State
                    </button>
                  </div>
                </div>
              )}

              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                Revoking or granting permissions updates the database in real-time. Changes take effect on the administrator's next request without requiring re-login.
              </p>

              <div className="permission-matrix-section" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
                {(catalog.modules || []).map(mod => (
                  <div key={mod.id} className="permission-module-card">
                    <div className="permission-module-header">
                      <div className="permission-module-title">
                        {mod.name}
                      </div>
                      <button
                        type="button"
                        style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
                        onClick={() => handleModuleToggle(mod, editPermissions, setEditPermissions)}
                      >
                        {(mod.permissions || []).every(p => editPermissions.includes(p.id)) ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div className="permission-module-items">
                      {(mod.permissions || []).map(perm => (
                        <label key={perm.id} className="permission-item-label">
                          <input
                            type="checkbox"
                            className="permission-checkbox"
                            value={perm.id}
                            checked={editPermissions.includes(perm.id)}
                            onChange={() => handlePermissionToggle(perm.id, editPermissions, setEditPermissions)}
                          />
                          <div className="permission-item-text">
                            <span className="permission-item-name">{perm.name}</span>
                            <span className="permission-item-desc">{perm.description}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Effective Access Summary */}
              <div className="effective-access-box">
                <div className="effective-access-title">
                  <ShieldCheck size={16} /> Updated Effective Access Summary ({editPermissions.length} permissions)
                </div>
                <div className="effective-access-list">
                  {editPermissions.map(p => (
                    <span key={p} className="effective-access-chip">
                      {p}
                    </span>
                  ))}
                  {editPermissions.length === 0 && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      No operational permissions granted (Landing page and profile only).
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="admin-modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setEditAdmin(null)}>
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-super-primary" 
                onClick={handlePrepareDiffPreview}
                disabled={isSubmitting}
              >
                <Check size={16} /> Review & Save Changes
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 1. Archive Administrator Modal */}
      {archiveTarget && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setArchiveTarget(null)}>
          <div className="admin-modal-dialog admin-modal" style={{ maxWidth: '520px', width: '90vw' }}>
            <div className="admin-modal-header" style={{ borderBottomColor: 'rgba(239, 68, 68, 0.3)' }}>
              <h2><Archive size={20} color="#f87171" /> Archive Administrator</h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setArchiveTarget(null)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleConfirmArchive}>
              <div className="admin-modal-body">
                <div style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: '8px',
                  padding: '1rem',
                  marginBottom: '1.25rem',
                  fontSize: '0.85rem',
                  color: '#fca5a5'
                }}>
                  <strong>Warning:</strong> Archiving <strong>{archiveTarget.username}</strong> will immediately revoke all active sessions, invalidate tokens, and terminate login access. Their accountability history and business records will remain permanently intact.
                </div>

                {archiveError && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                    {archiveError}
                  </div>
                )}

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    Archive Reason (Required, min 5 characters)
                  </label>
                  <textarea
                    rows={3}
                    className="admin-input"
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px' }}
                    value={archiveReason}
                    onChange={(e) => setArchiveReason(e.target.value)}
                    placeholder="e.g., Staff departure, resignation, role reorganization..."
                    required
                    minLength={5}
                    data-testid="archive-reason-input"
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    Super Admin Password (Verification Required)
                  </label>
                  <input
                    type="password"
                    className="admin-input"
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px' }}
                    value={archiveSudoPassword}
                    onChange={(e) => setArchiveSudoPassword(e.target.value)}
                    placeholder="Enter your password to authorize..."
                    required
                    data-testid="archive-sudo-password-input"
                  />
                </div>
              </div>

              <div className="admin-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setArchiveTarget(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-danger"
                  style={{ background: '#e11d48', color: '#fff', border: 'none', padding: '0.5rem 1.25rem', borderRadius: '6px', fontWeight: 600 }}
                  disabled={isArchiving || archiveReason.trim().length < 5 || !archiveSudoPassword}
                  data-testid="confirm-archive-btn"
                >
                  {isArchiving ? 'Archiving...' : 'Archive Administrator'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* 2. Restore Administrator Modal */}
      {restoreTarget && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setRestoreTarget(null)}>
          <div className="admin-modal-dialog admin-modal" style={{ maxWidth: '520px', width: '90vw' }}>
            <div className="admin-modal-header" style={{ borderBottomColor: 'rgba(56, 189, 248, 0.3)' }}>
              <h2><RotateCcw size={20} color="#38bdf8" /> Restore Administrator</h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setRestoreTarget(null)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleConfirmRestore}>
              <div className="admin-modal-body">
                <div style={{
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: '8px',
                  padding: '1rem',
                  marginBottom: '1.25rem',
                  fontSize: '0.85rem',
                  color: '#93c5fd'
                }}>
                  <strong>Restoration Rule:</strong> Restoring <strong>{restoreTarget.username}</strong> returns their account to the Current Administrators list strictly as <strong>INACTIVE</strong>. You must review their permissions and explicitly activate the account via the status toggle before access resumes.
                </div>

                {restoreError && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                    {restoreError}
                  </div>
                )}

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    Restore Reason (Required, min 5 characters)
                  </label>
                  <textarea
                    rows={3}
                    className="admin-input"
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px' }}
                    value={restoreReason}
                    onChange={(e) => setRestoreReason(e.target.value)}
                    placeholder="e.g., Rehired staff member, returning from sabbatical..."
                    required
                    minLength={5}
                    data-testid="restore-reason-input"
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    Super Admin Password (Verification Required)
                  </label>
                  <input
                    type="password"
                    className="admin-input"
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px' }}
                    value={restoreSudoPassword}
                    onChange={(e) => setRestoreSudoPassword(e.target.value)}
                    placeholder="Enter your password to authorize..."
                    required
                    data-testid="restore-sudo-password-input"
                  />
                </div>
              </div>

              <div className="admin-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setRestoreTarget(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ padding: '0.5rem 1.25rem', borderRadius: '6px', fontWeight: 600 }}
                  disabled={isRestoring || restoreReason.trim().length < 5 || !restoreSudoPassword}
                  data-testid="confirm-restore-btn"
                >
                  {isRestoring ? 'Restoring...' : 'Restore as Inactive'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* 3. Password Reset Initiation Modal */}
      {resetTarget && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setResetTarget(null)}>
          <div className="admin-modal-dialog admin-modal" style={{ maxWidth: '540px', width: '90vw' }}>
            <div className="admin-modal-header" style={{ borderBottomColor: 'rgba(245, 158, 11, 0.3)' }}>
              <h2><Key size={20} color="#fbbf24" /> Reset Administrator Password</h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setResetTarget(null)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleConfirmReset}>
              <div className="admin-modal-body">
                {/* Target User Details & Verification Status */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.08))',
                  borderRadius: '8px',
                  padding: '1rem',
                  marginBottom: '1.25rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{resetTarget.first_name} {resetTarget.last_name}</div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{resetTarget.username} &bull; {resetTarget.email}</div>
                    </div>
                    {resetTarget.email_verified_at ? (
                      <span className="badge-verified-email" data-testid="verified-email-badge">
                        <Check size={12} /> Email Verified
                      </span>
                    ) : (
                      <span className="badge-unverified-email" data-testid="unverified-email-badge">
                        <AlertTriangle size={12} /> Email Unverified
                      </span>
                    )}
                  </div>
                </div>

                {resetError && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                    {resetError}
                  </div>
                )}

                {/* Delivery Mode Selection */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                    Recovery Delivery Mode
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '6px',
                      border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.1))',
                      background: resetMethod === 'email' ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                      cursor: resetTarget.email_verified_at ? 'pointer' : 'not-allowed',
                      opacity: resetTarget.email_verified_at ? 1 : 0.5
                    }}>
                      <input
                        type="radio"
                        name="resetMethod"
                        value="email"
                        checked={resetMethod === 'email'}
                        onChange={() => setResetMethod('email')}
                        disabled={!resetTarget.email_verified_at}
                        data-testid="radio-reset-email"
                      />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Dispatch Link via Verified Email</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          Sends single-use link to verified address {resetTarget.email} (valid 30 minutes)
                        </div>
                      </div>
                    </label>

                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '6px',
                      border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.1))',
                      background: resetMethod === 'direct' ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="radio"
                        name="resetMethod"
                        value="direct"
                        checked={resetMethod === 'direct'}
                        onChange={() => setResetMethod('direct')}
                        data-testid="radio-reset-direct"
                      />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Generate Secure Out-of-Band Link</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          Generates copyable URL fragment link for manual delivery over phone/chat (valid 30 minutes)
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    Reason for Reset (Audited)
                  </label>
                  <input
                    type="text"
                    className="admin-input"
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px' }}
                    value={resetReason}
                    onChange={(e) => setResetReason(e.target.value)}
                    placeholder="e.g., Routine security rotation, admin locked out..."
                    data-testid="reset-reason-input"
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    Super Admin Password (Verification Required)
                  </label>
                  <input
                    type="password"
                    className="admin-input"
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px' }}
                    value={resetSudoPassword}
                    onChange={(e) => setResetSudoPassword(e.target.value)}
                    placeholder="Enter your password to authorize..."
                    required
                    data-testid="reset-sudo-password-input"
                  />
                </div>
              </div>

              <div className="admin-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setResetTarget(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ padding: '0.5rem 1.25rem', borderRadius: '6px', fontWeight: 600 }}
                  disabled={isResetting || !resetSudoPassword}
                  data-testid="confirm-reset-btn"
                >
                  {isResetting ? 'Processing...' : resetMethod === 'email' ? 'Dispatch Reset Email' : 'Generate Direct Link'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}


      {/* ── Super Admin Governance Modal (Promote / Demote) ──────────────── */}
      {govModal && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setGovModal(null)}>
          <div className="admin-modal-dialog admin-modal" style={{ maxWidth: '520px', width: '90vw' }}>
            <div className="admin-modal-header" style={{ borderBottomColor: govModal.action === 'promote' ? 'rgba(168, 85, 247, 0.4)' : 'rgba(239, 68, 68, 0.4)' }}>
              <h2>
                {govModal.action === 'promote' ? (
                  <><ShieldCheck size={20} color="#a855f7" /> Promote to Super Administrator</>
                ) : (
                  <><RotateCcw size={20} color="#ef4444" /> Demote to Ordinary Administrator</>
                )}
              </h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setGovModal(null)} data-testid="close-gov-modal-btn">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleConfirmGovernance}>
              <div className="admin-modal-body">
                {/* Target User Info */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  padding: '1rem',
                  borderRadius: '8px',
                  marginBottom: '1.25rem',
                  border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.1))'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{govModal.admin.first_name} {govModal.admin.last_name}</div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                        {govModal.admin.username} &bull; {govModal.admin.email}
                      </div>
                    </div>
                    <span className="badge-pill" style={{ fontSize: '0.75rem' }}>
                      ID: {govModal.admin.id}
                    </span>
                  </div>
                </div>

                {/* Explanatory / Warning Callout */}
                {govModal.action === 'demote' ? (
                  <div style={{
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#fca5a5',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    marginBottom: '1.25rem',
                    fontSize: '0.85rem',
                    lineHeight: 1.45
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <AlertTriangle size={15} /> Immediate Governance Impact
                    </div>
                    Demoting this Super Admin strips all privileges to 0 permissions and revokes all active sessions immediately. They will be forced to log in again and will require deliberate permission assignment.
                  </div>
                ) : (
                  <div style={{
                    background: 'rgba(168, 85, 247, 0.12)',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    color: '#e9d5ff',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    marginBottom: '1.25rem',
                    fontSize: '0.85rem',
                    lineHeight: 1.45
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <ShieldCheck size={15} /> Full Platform Authority
                    </div>
                    Promoting this administrator grants full, unconditional platform privileges (*). Their sessions will be revoked and a fresh login with 2FA will be required.
                  </div>
                )}

                {govError && (
                  <div style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#fca5a5',
                    padding: '0.75rem',
                    borderRadius: '6px',
                    marginBottom: '1rem',
                    fontSize: '0.85rem'
                  }}>
                    {govError}
                  </div>
                )}

                {/* Step-Up Verification Code */}
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    {govUseRecovery ? 'Emergency Backup Recovery Code' : '6-Digit Authenticator Code (Step-Up Verification)'}
                  </label>
                  <input
                    type="text"
                    className="admin-input"
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', fontFamily: 'monospace', textAlign: 'center', fontSize: '1.1rem', letterSpacing: '0.15em' }}
                    value={govUseRecovery ? govRecoveryCode : govCode}
                    onChange={(e) => {
                      if (govUseRecovery) {
                        setGovRecoveryCode(e.target.value);
                      } else {
                        setGovCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                      }
                    }}
                    placeholder={govUseRecovery ? 'e.g. A1B2-C3D4' : '000 000'}
                    maxLength={govUseRecovery ? 30 : 6}
                    required
                    autoFocus
                    data-testid="gov-code-input"
                  />
                  <div style={{ marginTop: '0.4rem', textAlign: 'right' }}>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline' }}
                      onClick={() => {
                        setGovUseRecovery(!govUseRecovery);
                        setGovError('');
                      }}
                    >
                      {govUseRecovery ? '← Use 6-Digit Authenticator Code' : 'Lost device? Use Recovery Code'}
                    </button>
                  </div>
                </div>

                {/* Optional Sudo Password */}
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    Account Password (Re-authentication)
                  </label>
                  <input
                    type="password"
                    className="admin-input"
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px' }}
                    value={govSudoPassword}
                    onChange={(e) => setGovSudoPassword(e.target.value)}
                    placeholder="Enter your current password..."
                    data-testid="gov-sudo-password-input"
                  />
                </div>
              </div>

              <div className="admin-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setGovModal(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className={govModal.action === 'promote' ? 'btn-primary' : 'btn-danger'}
                  style={{
                    padding: '0.5rem 1.25rem',
                    borderRadius: '6px',
                    fontWeight: 600,
                    background: govModal.action === 'promote' ? '#a855f7' : '#ef4444'
                  }}
                  disabled={isGovSubmitting || (govUseRecovery ? !govRecoveryCode.trim() : govCode.length !== 6)}
                  data-testid="confirm-gov-btn"
                >
                  {isGovSubmitting ? 'Processing...' : govModal.action === 'promote' ? 'Confirm Promotion' : 'Confirm Demotion'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* 4. Out-of-Band Direct Link Modal */}
      {directLinkResult && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setDirectLinkResult(null)}>
          <div className="admin-modal-dialog admin-modal" style={{ maxWidth: '580px', width: '90vw' }}>
            <div className="admin-modal-header" style={{ borderBottomColor: 'rgba(56, 189, 248, 0.3)' }}>
              <h2><Key size={20} color="#38bdf8" /> Direct Recovery Link Generated</h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setDirectLinkResult(null)} data-testid="close-direct-link-btn">
                <X size={20} />
              </button>
            </div>

            <div className="admin-modal-body">
              <div style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: '8px',
                padding: '0.85rem',
                marginBottom: '1rem',
                fontSize: '0.85rem',
                color: '#6ee7b7'
              }}>
                <CheckCircle2 size={16} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom' }} />
                Active sessions for this account have been terminated. The account will remain in reset-pending status until this link is consumed.
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                  One-Time Reset Link (URL Fragment Transport)
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    readOnly
                    className="admin-input"
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.8rem', padding: '0.6rem', borderRadius: '6px' }}
                    value={directLinkResult.direct_url}
                    data-testid="direct-link-input"
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}
                    onClick={() => {
                      navigator.clipboard.writeText(directLinkResult.direct_url);
                      setCopiedDirectLink(true);
                      setTimeout(() => setCopiedDirectLink(false), 3000);
                    }}
                    data-testid="copy-direct-link-btn"
                  >
                    {copiedDirectLink ? <CheckCheck size={16} color="#34d399" /> : <Copy size={16} />}
                    {copiedDirectLink ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* 30-Minute Live Countdown Timer */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '0.75rem',
                borderRadius: '6px',
                background: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                color: '#fbbf24',
                fontSize: '0.85rem',
                fontWeight: 600,
                marginBottom: '1rem'
              }} data-testid="direct-link-timer">
                <Clock size={16} />
                <span>Link Expires In: {Math.floor(directLinkTimer / 60)}m {String(directLinkTimer % 60).padStart(2, '0')}s</span>
              </div>

              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Security Notice:</strong> Deliver this link exclusively over a verified out-of-band channel. Because the token is encoded in the URL fragment, it is never transmitted to intermediate proxy or server logs.
              </div>
            </div>

            <div className="admin-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setDirectLinkResult(null)}
                data-testid="done-direct-link-btn"
                style={{ padding: '0.5rem 1.5rem', borderRadius: '6px', fontWeight: 600 }}
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Deep Accountability Profile Modal with Dual Timelines */}
      {showProfileModal && typeof document !== 'undefined' && createPortal(
        <div className="admin-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setShowProfileModal(false)}>
          <div className="admin-modal-dialog admin-modal" style={{ maxWidth: '820px', width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="admin-modal-header">
              <h2><ShieldCheck size={20} color="#38bdf8" /> Administrator Accountability Profile</h2>
              <button type="button" className="admin-modal-close-btn" onClick={() => setShowProfileModal(false)} data-testid="close-profile-modal">
                <X size={20} />
              </button>
            </div>

            <div className="admin-modal-body">
              {profileLoading ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  <RefreshCw size={24} className="spin" style={{ marginBottom: '0.5rem' }} />
                  <div>Loading administrator accountability profile...</div>
                </div>
              ) : profileData && profileData.admin ? (
                <div>
                  {/* Identity Header */}
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.08))',
                    borderRadius: '10px',
                    padding: '1.25rem',
                    marginBottom: '1.25rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {profileData.admin.fullName || profileData.admin.username}
                          </h3>
                          {profileData.admin.isSuperAdmin ? (
                            <span className="badge-super-admin"><Shield size={11} /> Super Admin</span>
                          ) : (
                            <span className="badge-ordinary-admin">Admin</span>
                          )}
                          <span className={`status-toggle-pill ${profileData.admin.isActive ? 'active' : 'inactive'}`} style={{ cursor: 'default' }}>
                            {profileData.admin.isActive ? <Check size={11} /> : <X size={11} />}
                            {profileData.admin.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                          <span style={{ fontFamily: 'monospace' }}>{profileData.admin.username}</span> &bull; {profileData.admin.email}
                        </div>
                      </div>

                      {/* Creator Attribution */}
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Created By
                        </div>
                        <div style={{ marginTop: '2px' }}>
                          <span className={`creator-pill ${profileData.admin.creator?.isLegacy ? 'legacy' : 'named'}`} data-testid="profile-creator-attribution">
                            {profileData.admin.creator?.name || 'Unknown/Legacy'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border, rgba(255, 255, 255, 0.06))', fontSize: '0.82rem' }}>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Created: </span>
                        <strong>{profileData.admin.createdAtDhaka || profileData.admin.createdAt}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>Last Login: </span>
                        <strong>{profileData.admin.lastLoginDhaka || profileData.admin.lastLogin || 'Never logged in'}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary)' }}>MFA Status: </span>
                        <strong style={{ color: profileData.security?.mfaEnabled ? '#34d399' : '#f87171' }}>
                          {profileData.security?.mfaEnabled ? 'Enrolled & Active' : 'Not Enrolled'}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Dual Timeline & Sections Navigation */}
                  <div className="timeline-tabs" data-testid="profile-subtabs">
                    <button
                      type="button"
                      className={`timeline-tab-btn ${profileTab === 'performed' ? 'active' : ''}`}
                      onClick={() => setProfileTab('performed')}
                      data-testid="tab-timeline-performed"
                    >
                      <Activity size={14} /> Actions Performed ({profileData.actionsPerformedTimeline?.length || 0})
                    </button>
                    <button
                      type="button"
                      className={`timeline-tab-btn ${profileTab === 'received' ? 'active' : ''}`}
                      onClick={() => setProfileTab('received')}
                      data-testid="tab-timeline-received"
                    >
                      <Clock size={14} /> Changes Received ({profileData.changesReceivedTimeline?.length || 0})
                    </button>
                    <button
                      type="button"
                      className={`timeline-tab-btn ${profileTab === 'security' ? 'active' : ''}`}
                      onClick={() => setProfileTab('security')}
                      data-testid="tab-profile-security"
                    >
                      <Key size={14} /> Security History ({profileData.security?.events?.length || 0})
                    </button>
                    <button
                      type="button"
                      className={`timeline-tab-btn ${profileTab === 'permissions' ? 'active' : ''}`}
                      onClick={() => setProfileTab('permissions')}
                      data-testid="tab-profile-permissions"
                    >
                      <Shield size={14} /> Permissions ({profileData.effectivePermissions?.length || 0})
                    </button>
                  </div>

                  {/* Subtab 1: Timeline of Actions Performed by this Admin */}
                  {profileTab === 'performed' && (
                    <div>
                      <div className="timeline-entry-list" data-testid="timeline-performed-list">
                        {(profileData.actionsPerformedTimeline || []).map((entry) => (
                          <div key={entry.id} className="timeline-entry-card">
                            <div className="timeline-entry-header">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className={`module-badge module-${entry.module || 'admin_management'}`}>{entry.module || 'admin'}</span>
                                <strong style={{ color: '#38bdf8', fontSize: '0.85rem' }}>{entry.action}</strong>
                                {entry.resource && (
                                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                    &bull; {entry.resource}
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className={`outcome-pill outcome-${entry.outcome || 'success'}`}>{entry.outcome || 'success'}</span>
                                <span className="timeline-entry-time">{entry.dhaka_time}</span>
                              </div>
                            </div>
                            {entry.details && (
                              <div className="timeline-entry-details">
                                {typeof entry.details === 'object' ? JSON.stringify(entry.details, null, 2) : String(entry.details)}
                              </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                              <span>IP: {entry.ip_address || '127.0.0.1'}</span>
                              {entry.correlation_id && <span>Corr ID: {entry.correlation_id}</span>}
                            </div>
                          </div>
                        ))}

                        {(profileData.actionsPerformedTimeline || []).length === 0 && (
                          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                            No recorded operational actions performed by this administrator.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Subtab 2: Timeline of Changes Made to this Admin */}
                  {profileTab === 'received' && (
                    <div>
                      <div className="timeline-entry-list" data-testid="timeline-received-list">
                        {(profileData.changesReceivedTimeline || []).map((entry) => (
                          <div key={entry.id} className="timeline-entry-card">
                            <div className="timeline-entry-header">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.85rem' }}>
                                  Changed by: <strong>{entry.actor_username || `Admin #${entry.actor_id || 'System'}`}</strong>
                                </span>
                                <span className={`module-badge module-${entry.module || 'admin_management'}`}>{entry.module || 'admin'}</span>
                                <strong style={{ color: '#fb7185', fontSize: '0.85rem' }}>{entry.action}</strong>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className={`outcome-pill outcome-${entry.outcome || 'success'}`}>{entry.outcome || 'success'}</span>
                                <span className="timeline-entry-time">{entry.dhaka_time}</span>
                              </div>
                            </div>
                            {entry.details && (
                              <div className="timeline-entry-details">
                                {typeof entry.details === 'object' ? JSON.stringify(entry.details, null, 2) : String(entry.details)}
                              </div>
                            )}
                          </div>
                        ))}

                        {(profileData.changesReceivedTimeline || []).length === 0 && (
                          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                            No account mutations or permission modifications recorded for this administrator.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Subtab 3: Security History & Active Sessions */}
                  {profileTab === 'security' && (
                    <div>
                      <div style={{ marginBottom: '1.25rem' }}>
                        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-primary)' }}>Active Sessions</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {(profileData.security?.activeSessions || []).map(sess => (
                            <div key={sess.id} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(0, 0, 0, 0.25)', padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.06))' }}>
                              <span>IP: <code>{sess.ip_address || '127.0.0.1'}</code> &bull; Agent: {String(sess.user_agent || 'Unknown').substring(0, 40)}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>Expires: {sess.expires_at_dhaka || sess.expires_at}</span>
                            </div>
                          ))}
                          {(profileData.security?.activeSessions || []).length === 0 && (
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No active sessions recorded.</div>
                          )}
                        </div>
                      </div>

                      <div>
                        <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-primary)' }}>Security Events Log</h4>
                        <div className="timeline-entry-list">
                          {(profileData.security?.events || []).map(ev => (
                            <div key={ev.id} className="timeline-entry-card">
                              <div className="timeline-entry-header">
                                <span style={{ fontWeight: 600, color: '#fca5a5', fontSize: '0.85rem' }}>{ev.action}</span>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                  <span className={`outcome-pill outcome-${ev.outcome || 'success'}`}>{ev.outcome || 'success'}</span>
                                  <span className="timeline-entry-time">{ev.dhaka_time}</span>
                                </div>
                              </div>
                              {ev.details && (
                                <div className="timeline-entry-details">
                                  {typeof ev.details === 'object' ? JSON.stringify(ev.details) : String(ev.details)}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Subtab 4: Effective Permissions */}
                  {profileTab === 'permissions' && (
                    <div>
                      {profileData.admin.isSuperAdmin ? (
                        <div style={{ padding: '1rem', background: 'rgba(251, 113, 133, 0.1)', border: '1px solid rgba(251, 113, 133, 0.3)', borderRadius: '8px', color: '#fb7185' }}>
                          <Shield size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                          <strong>Root Super Administrator:</strong> Possesses all platform permissions unconditionally (<code>*</code>).
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {(profileData.effectivePermissions || []).map(p => (
                            <span key={p} className="module-badge module-admin_management" style={{ fontSize: '0.8rem', padding: '4px 10px' }}>
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color: '#f87171', textAlign: 'center', padding: '2rem' }}>
                  Administrator profile not found.
                </div>
              )}
            </div>

            <div className="admin-modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setShowProfileModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
