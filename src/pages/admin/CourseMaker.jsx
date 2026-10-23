import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { createPortal } from 'react-dom';
import BatchFormModal from '../../components/admin/BatchFormModal';
import './CourseMaker.css';
import {
  Layers, Plus, Trash2, CheckCircle2, AlertCircle, Edit3, Eye, Clock,
  Calendar, Award, BookOpen, Shield, ArrowRight, ArrowLeft, Check, X,
  History, Settings, FileText, ChevronRight, HelpCircle
} from 'lucide-react';

const API_BASE = '/api/admin/course-definitions';

const COURSE_TYPES = [
  { value: 'workshop', label: 'Workshop' },
  { value: 'filmmaking', label: 'Filmmaking Course' },
  { value: 'appreciation', label: 'Appreciation Course' },
  { value: 'certificate', label: 'Certificate Course' },
  { value: 'diploma', label: 'Diploma' },
  { value: 'masterclass', label: 'Masterclass' },
  { value: 'short_course', label: 'Short Course' }
];

function getCourseTypeLabel(type) {
  const found = COURSE_TYPES.find(t => t.value === type);
  return found ? found.label : (type || 'Course');
}

const DELIVERY_MODES = [
  { value: 'live', label: 'Live Online' },
  { value: 'recorded', label: 'Recorded' },
  { value: 'recorded_plus_live_discussion', label: 'Recorded + Live Discussion' }
];

const CLASS_CATEGORIES = [
  { value: 'theory', label: 'Theory & Lecture' },
  { value: 'shooting', label: 'Shooting & Practical' },
  { value: 'editing', label: 'Editing & Post' },
  { value: 'practical', label: 'Hands-on Exercise' },
  { value: 'other', label: 'General / Discussion' }
];

const WEEKDAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function generateId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).substr(2, 7)}`;
}

function buildDefaultPhase(index) {
  const pNum = index + 1;
  return {
    id: `phase_${pNum}`,
    phaseIndex: pNum,
    title: `Phase ${pNum}`,
    description: '',
    duration: { value: 4, unit: 'weeks' },
    classCount: 2,
    requirements: {
      attendanceRequired: true,
      minAttendancePercent: 75,
      completionRequired: true
    },
    routine: [
      { weekday: 'Saturday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka' }
    ],
    classes: [
      {
        id: generateId('cls'),
        title: `Introduction & Fundamentals`,
        subjectName: '',
        teacherName: '',
        deliveryMode: 'live',
        category: 'theory',
        durationMinutes: 120,
        mandatory: true
      }
    ],
    assignments: [
      {
        id: generateId('asg'),
        title: `Exercise 1`,
        subject: '',
        instructions: 'Complete and submit practical task.',
        submissionRequired: true,
        maxMarks: 20,
        passMarks: 10
      }
    ],
    exam: {
      enabled: false,
      title: `Phase ${pNum} Assessment`,
      type: 'written',
      maxMarks: 80,
      passMarks: 35,
      phasePassThreshold: 50,
      includeAssignmentsInTotal: true
    }
  };
}

const DRAFT_STORAGE_PREFIX = 'bfi_course_maker_unsaved_draft_';
function getDraftStorageKey(userId) {
  return `${DRAFT_STORAGE_PREFIX}${userId || 'anon'}`;
}

function buildDefaultForm() {
  return {
    name: '',
    course_type: 'workshop',
    description: '',
    duration: { value: 3, unit: 'months' },
    phaseCount: 1,
    phases: [buildDefaultPhase(0)],
    completionPolicy: {
      certificateEligibility: {
        allRequiredPhasesPassed: true,
        minOverallAttendance: 75,
        requireAllMandatoryClasses: true,
        requireAllMandatoryAssignments: true,
        requireFeesPaid: true
      },
      phaseGates: {
        sequentialProgression: true,
        requirePreviousPhasePassed: true
      },
      reEnrollment: {
        discountEnabled: true,
        discountPercentage: 50
      }
    }
  };
}

export default function CourseMaker() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.id || (() => {
    try {
      return JSON.parse(localStorage.getItem('auth_user_cache') || '{}').id;
    } catch {
      return null;
    }
  })() || 'default_admin';

  // Navigation & View States
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'builder' | 'review'
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [createBatchTargetCourse, setCreateBatchTargetCourse] = useState(null);
  const [showBatchModal, setShowBatchModal] = useState(false);

  // Reference Catalogs
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);

  // Builder Form State
  const [editingDefId, setEditingDefId] = useState(null);
  const [activePhaseTab, setActivePhaseTab] = useState(0);
  const [form, setForm] = useState(buildDefaultForm());

  // Persistence tracking states
  const isInitializedRef = useRef(false);
  const baselineFormJsonRef = useRef(null);
  const phaseTabRefs = useRef([]);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [hasUnsavedDraftInStorage, setHasUnsavedDraftInStorage] = useState(false);

  // Routine Audit Modal State
  const [auditModalDef, setAuditModalDef] = useState(null);
  const [auditSelectedPhaseId, setAuditSelectedPhaseId] = useState('');
  const [auditRoutineList, setAuditRoutineList] = useState([]);
  const [auditReason, setAuditReason] = useState('');
  const [auditHistory, setAuditHistory] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // URL synchronization helper
  const syncUrl = (targetMode, targetDraftId, targetPhaseIdx, replace = false) => {
    const params = new URLSearchParams();
    if (targetMode && targetMode !== 'list') {
      params.set('mode', targetMode);
      if (targetDraftId) {
        params.set('draftId', String(targetDraftId));
      }
      if (targetMode === 'builder' && targetPhaseIdx !== undefined && targetPhaseIdx !== null) {
        params.set('phase', String(targetPhaseIdx + 1));
      }
    }
    setSearchParams(params, { replace });
  };

  const fetchCourses = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await fetch(API_BASE, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCourses(Array.isArray(data) ? data : (data.definitions || []));
      }
    } catch (err) {
      console.error('Failed to fetch course definitions', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalogs = async () => {
    try {
      const token = localStorage.getItem('token');
      // Fetch teachers
      const tRes = await fetch('/api/admin/teachers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (tRes.ok) {
        const tData = await tRes.json();
        setTeachers(tData.teachers || []);
      }
      // Fetch custom subjects
      const sRes = await fetch('/api/admin/custom-subjects', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (sRes.ok) {
        const sData = await sRes.json();
        setSubjects(sData.subjects || sData || []);
      }
    } catch (err) {
      console.error('Failed to fetch catalogs', err);
    }
  };

  // Synchronize state from URL and localStorage on mount
  useEffect(() => {
    const initFromUrlAndStorage = async () => {
      await fetchCourses();
      await fetchCatalogs();

      const urlMode = searchParams.get('mode');
      const urlDraftId = searchParams.get('draftId');
      const urlPhase = searchParams.get('phase');

      const storageKey = getDraftStorageKey(currentUserId);
      const savedRaw = localStorage.getItem(storageKey);
      let localDraft = null;
      if (savedRaw) {
        try {
          localDraft = JSON.parse(savedRaw);
          setHasUnsavedDraftInStorage(true);
        } catch {
          localStorage.removeItem(storageKey);
        }
      }

      if (urlDraftId) {
        const parsedDraftId = parseInt(urlDraftId, 10);
        if (isNaN(parsedDraftId)) {
          showToast('Invalid draft ID in URL', 'error');
          syncUrl('list', null, null, true);
          setViewMode('list');
          isInitializedRef.current = true;
          return;
        }

        try {
          setLoading(true);
          const token = localStorage.getItem('token');
          const res = await fetch(`${API_BASE}/${parsedDraftId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Course definition not found or deleted.');
          }

          const def = data.definition || data;
          if (data.status === 'published' || def.status === 'published') {
            showToast('Course definition is published and locked. Routine edits can be managed via Routine & Audits.', 'error');
            syncUrl('list', null, null, true);
            setViewMode('list');
            isInitializedRef.current = true;
            return;
          }

          let parsedJson = {};
          if (data.definition && typeof data.definition === 'object') {
            parsedJson = data.definition;
          } else if (data.definition_json) {
            try {
              parsedJson = JSON.parse(data.definition_json);
            } catch {
              parsedJson = {};
            }
          }

          const serverForm = {
            name: data.name || def.name || parsedJson.basics?.name || '',
            course_type: data.course_type || def.course_type || parsedJson.basics?.type || 'workshop',
            description: data.description || def.description || parsedJson.basics?.description || '',
            duration: parsedJson.basics?.duration || { value: data.duration_value || 3, unit: data.duration_unit || 'months' },
            phaseCount: data.phase_count || def.phase_count || parsedJson.phases?.length || 1,
            phases: (parsedJson.phases && parsedJson.phases.length > 0) ? parsedJson.phases : [buildDefaultPhase(0)],
            completionPolicy: parsedJson.completionPolicy || {
              certificateEligibility: { allRequiredPhasesPassed: true, minOverallAttendance: 75, requireFeesPaid: true },
              phaseGates: { sequentialProgression: true, requirePreviousPhasePassed: true },
              reEnrollment: { discountEnabled: true, discountPercentage: 50 }
            }
          };

          let formToSet = serverForm;
          let isDraftDirty = false;
          if (localDraft && localDraft.editingDefId === parsedDraftId && localDraft.form) {
            formToSet = localDraft.form;
            isDraftDirty = true;
            baselineFormJsonRef.current = null;
          } else {
            baselineFormJsonRef.current = JSON.stringify(serverForm);
          }

          const phaseIdx = urlPhase ? Math.max(0, Math.min(formToSet.phases.length - 1, parseInt(urlPhase, 10) - 1)) : 0;
          setEditingDefId(parsedDraftId);
          setForm(formToSet);
          setActivePhaseTab(phaseIdx);
          setIsDirty(isDraftDirty);
          setViewMode(urlMode === 'review' ? 'review' : 'builder');
        } catch (err) {
          console.error('Failed to load server draft:', err);
          showToast(err.message, 'error');
          syncUrl('list', null, null, true);
          setViewMode('list');
        } finally {
          setLoading(false);
          isInitializedRef.current = true;
        }
        return;
      }

      if (urlMode === 'builder' || urlMode === 'review') {
        if (localDraft && localDraft.form && !localDraft.editingDefId) {
          setForm(localDraft.form);
          setEditingDefId(null);
          const maxPhases = localDraft.form.phases ? localDraft.form.phases.length : 1;
          const phaseIdx = urlPhase ? Math.max(0, Math.min(maxPhases - 1, parseInt(urlPhase, 10) - 1)) : (localDraft.activePhaseTab || 0);
          setActivePhaseTab(phaseIdx);
          setIsDirty(true);
          setLastSavedTime(localDraft.savedAt ? new Date(localDraft.savedAt).toLocaleTimeString() : null);
          setViewMode(urlMode);
        } else {
          const defaultF = buildDefaultForm();
          baselineFormJsonRef.current = JSON.stringify(defaultF);
          setForm(defaultF);
          setEditingDefId(null);
          setActivePhaseTab(0);
          setIsDirty(false);
          setViewMode('builder');
        }
      } else {
        setViewMode('list');
      }

      isInitializedRef.current = true;
    };

    initFromUrlAndStorage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back/Forward navigation listener
  useEffect(() => {
    if (!isInitializedRef.current) return;
    const urlMode = searchParams.get('mode') || 'list';
    const urlDraftId = searchParams.get('draftId') ? parseInt(searchParams.get('draftId'), 10) : null;
    const urlPhase = searchParams.get('phase') ? parseInt(searchParams.get('phase'), 10) - 1 : 0;

    if (urlMode !== viewMode) {
      setViewMode(urlMode);
    }
    if (urlDraftId !== editingDefId) {
      setEditingDefId(urlDraftId);
    }
    if (urlPhase >= 0 && urlPhase !== activePhaseTab) {
      setActivePhaseTab(urlPhase);
    }
  }, [searchParams, viewMode, editingDefId, activePhaseTab]);

  // Auto-save form state to localStorage
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (viewMode === 'list') return;

    const currentJson = JSON.stringify(form);
    const hasChanged = baselineFormJsonRef.current !== null && currentJson !== baselineFormJsonRef.current;

    // Do not mark dirty or persist if form has not changed from baseline and wasn't already dirty
    if (!hasChanged && !isDirty) {
      return;
    }

    const storageKey = getDraftStorageKey(currentUserId);
    const draftPayload = {
      form,
      editingDefId,
      activePhaseTab,
      viewMode,
      isDirty: true,
      savedAt: new Date().toISOString()
    };

    try {
      localStorage.setItem(storageKey, JSON.stringify(draftPayload));
      setIsDirty(true);
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setHasUnsavedDraftInStorage(true);
    } catch (e) {
      console.error('Failed to cache course draft in localStorage:', e);
    }
  }, [form, activePhaseTab, viewMode, editingDefId, currentUserId, isDirty]);

  // Warn before unload if dirty
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty && viewMode !== 'list') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, viewMode]);

  // Phase tab switch with URL synchronization
  const switchPhaseTab = (pIdx) => {
    setActivePhaseTab(pIdx);
    syncUrl(viewMode, editingDefId, pIdx, true);
    setTimeout(() => {
      const tabEl = phaseTabRefs.current[pIdx];
      if (tabEl && typeof tabEl.scrollIntoView === 'function') {
        tabEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      }
    }, 10);
  };

  const handlePhaseTabKeyDown = (e, pIdx) => {
    let nextIdx = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIdx = (pIdx + 1) % form.phases.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIdx = (pIdx - 1 + form.phases.length) % form.phases.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIdx = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIdx = form.phases.length - 1;
    }
    if (nextIdx !== null) {
      switchPhaseTab(nextIdx);
      phaseTabRefs.current[nextIdx]?.focus();
    }
  };

  // Handle phase count change (1 to 5)
  const handlePhaseCountChange = (newCount) => {
    const count = Math.max(1, Math.min(5, parseInt(newCount, 10) || 1));
    const currentPhases = [...form.phases];

    if (count > currentPhases.length) {
      for (let i = currentPhases.length; i < count; i++) {
        currentPhases.push(buildDefaultPhase(i));
      }
    } else if (count < currentPhases.length) {
      currentPhases.splice(count);
    }

    setForm({
      ...form,
      phaseCount: count,
      phases: currentPhases
    });

    if (activePhaseTab >= count) {
      setActivePhaseTab(count - 1);
      syncUrl(viewMode, editingDefId, count - 1, true);
    }
  };

  const startNewCourse = () => {
    const storageKey = getDraftStorageKey(currentUserId);
    const existingRaw = localStorage.getItem(storageKey);
    let initialForm = buildDefaultForm();
    let initialPhase = 0;
    let initialDirty = false;

    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw);
        if (parsed.form && !parsed.editingDefId) {
          initialForm = parsed.form;
          initialPhase = parsed.activePhaseTab || 0;
          initialDirty = true;
        }
      } catch { /* empty */ }
    }

    if (!existingRaw || !initialDirty) {
      baselineFormJsonRef.current = JSON.stringify(initialForm);
    } else {
      baselineFormJsonRef.current = null;
    }

    setEditingDefId(null);
    setForm(initialForm);
    setActivePhaseTab(initialPhase);
    setIsDirty(initialDirty);
    setViewMode('builder');
    syncUrl('builder', null, initialPhase);
  };

  const resumeUnsavedDraft = () => {
    const storageKey = getDraftStorageKey(currentUserId);
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      if (draft.form) setForm(draft.form);
      if (draft.editingDefId) setEditingDefId(draft.editingDefId);
      const targetPhase = draft.activePhaseTab || 0;
      setActivePhaseTab(targetPhase);
      const targetMode = draft.viewMode || 'builder';
      setViewMode(targetMode);
      setIsDirty(true);
      syncUrl(targetMode, draft.editingDefId, targetPhase);
    } catch (err) {
      console.error('Failed to resume draft:', err);
    }
  };

  const handleDiscardDraft = () => {
    const storageKey = getDraftStorageKey(currentUserId);
    localStorage.removeItem(storageKey);
    const cleanForm = buildDefaultForm();
    baselineFormJsonRef.current = JSON.stringify(cleanForm);
    setForm(cleanForm);
    setEditingDefId(null);
    setActivePhaseTab(0);
    setIsDirty(false);
    setLastSavedTime(null);
    setHasUnsavedDraftInStorage(false);
    setShowDiscardModal(false);
    syncUrl('list', null, null);
    setViewMode('list');
    showToast('Unsaved draft has been discarded.', 'success');
  };

  const editDraftCourse = (courseDef) => {
    try {
      let parsed = {};
      if (courseDef.definition && typeof courseDef.definition === 'object') {
        parsed = courseDef.definition;
      } else if (courseDef.definition_json) {
        try {
          parsed = JSON.parse(courseDef.definition_json);
        } catch {
          parsed = {};
        }
      }

      const serverForm = {
        name: courseDef.name || parsed.basics?.name || '',
        course_type: courseDef.course_type || parsed.basics?.type || 'workshop',
        description: courseDef.description || parsed.basics?.description || '',
        duration: parsed.basics?.duration || { value: courseDef.duration_value || 3, unit: courseDef.duration_unit || 'months' },
        phaseCount: courseDef.phase_count || parsed.phases?.length || 1,
        phases: (parsed.phases && parsed.phases.length > 0) ? parsed.phases : [buildDefaultPhase(0)],
        completionPolicy: parsed.completionPolicy || {
          certificateEligibility: { allRequiredPhasesPassed: true, minOverallAttendance: 75, requireFeesPaid: true },
          phaseGates: { sequentialProgression: true, requirePreviousPhasePassed: true },
          reEnrollment: { discountEnabled: true, discountPercentage: 50 }
        }
      };

      const storageKey = getDraftStorageKey(currentUserId);
      const existingRaw = localStorage.getItem(storageKey);
      let formToUse = serverForm;
      let phaseToUse = 0;
      let dirtyToUse = false;

      if (existingRaw) {
        try {
          const localDraft = JSON.parse(existingRaw);
          if (localDraft.editingDefId === courseDef.id && localDraft.form) {
            formToUse = localDraft.form;
            phaseToUse = localDraft.activePhaseTab || 0;
            dirtyToUse = true;
          }
        } catch { /* empty */ }
      }

      if (!dirtyToUse) {
        baselineFormJsonRef.current = JSON.stringify(serverForm);
      } else {
        baselineFormJsonRef.current = null;
      }

      setEditingDefId(courseDef.id);
      setForm(formToUse);
      setActivePhaseTab(phaseToUse);
      setIsDirty(dirtyToUse);
      setViewMode('builder');
      syncUrl('builder', courseDef.id, phaseToUse);
    } catch (err) {
      console.error('Failed to load course definition details:', err);
      showToast('Failed to load course definition details', 'error');
    }
  };

  // Phase helpers
  const updateCurrentPhase = (updater) => {
    const updatedPhases = [...form.phases];
    updatedPhases[activePhaseTab] = {
      ...updatedPhases[activePhaseTab],
      ...updater
    };
    setForm({ ...form, phases: updatedPhases });
  };

  // Class helpers
  const addClassToPhase = () => {
    const cur = form.phases[activePhaseTab];
    const newClass = {
      id: generateId('cls'),
      title: `Class ${(cur.classes || []).length + 1}`,
      subjectName: '',
      teacherName: '',
      deliveryMode: 'live',
      category: 'theory',
      durationMinutes: 120,
      mandatory: true
    };
    updateCurrentPhase({
      classes: [...(cur.classes || []), newClass],
      classCount: (cur.classes || []).length + 1
    });
  };

  const removeClassFromPhase = (clsId) => {
    const cur = form.phases[activePhaseTab];
    const filtered = (cur.classes || []).filter(c => c.id !== clsId);
    updateCurrentPhase({
      classes: filtered,
      classCount: filtered.length
    });
  };

  const updateClassField = (clsId, field, val) => {
    const cur = form.phases[activePhaseTab];
    const updated = (cur.classes || []).map(c => c.id === clsId ? { ...c, [field]: val } : c);
    updateCurrentPhase({ classes: updated });
  };

  // Routine helpers
  const addRoutineToPhase = () => {
    const cur = form.phases[activePhaseTab];
    const newSlot = {
      weekday: 'Saturday',
      startTime: '18:00',
      endTime: '20:00',
      timezone: 'Asia/Dhaka'
    };
    updateCurrentPhase({ routine: [...(cur.routine || []), newSlot] });
  };

  const removeRoutineFromPhase = (index) => {
    const cur = form.phases[activePhaseTab];
    const filtered = (cur.routine || []).filter((_, i) => i !== index);
    updateCurrentPhase({ routine: filtered });
  };

  const updateRoutineField = (index, field, val) => {
    const cur = form.phases[activePhaseTab];
    const updated = (cur.routine || []).map((r, i) => i === index ? { ...r, [field]: val } : r);
    updateCurrentPhase({ routine: updated });
  };

  // Assignment helpers
  const addAssignmentToPhase = () => {
    const cur = form.phases[activePhaseTab];
    const newAsg = {
      id: generateId('asg'),
      title: `Assignment ${(cur.assignments || []).length + 1}`,
      subject: '',
      instructions: '',
      submissionRequired: true,
      maxMarks: 20,
      passMarks: 10
    };
    updateCurrentPhase({ assignments: [...(cur.assignments || []), newAsg] });
  };

  const removeAssignmentFromPhase = (asgId) => {
    const cur = form.phases[activePhaseTab];
    updateCurrentPhase({ assignments: (cur.assignments || []).filter(a => a.id !== asgId) });
  };

  const updateAssignmentField = (asgId, field, val) => {
    const cur = form.phases[activePhaseTab];
    const updated = (cur.assignments || []).map(a => a.id === asgId ? { ...a, [field]: val } : a);
    updateCurrentPhase({ assignments: updated });
  };

  // Client-side validation
  const validateForm = (isPublishing = false) => {
    const errors = [];
    if (!form.name || form.name.trim().length < 2) {
      errors.push('Course name must be at least 2 characters.');
    }
    if (form.phaseCount < 1 || form.phaseCount > 5) {
      errors.push('Course must have between 1 and 5 phases.');
    }

    form.phases.forEach((p, idx) => {
      const pNum = idx + 1;
      if (!p.title || p.title.trim().length === 0) {
        errors.push(`Phase ${pNum} must have a title.`);
      }
      if (isPublishing && (!p.classes || p.classes.length === 0)) {
        errors.push(`Phase ${pNum} must have at least one class.`);
      }
      (p.classes || []).forEach((c, cIdx) => {
        if (!c.title || c.title.trim().length === 0) {
          errors.push(`Phase ${pNum}, Class ${cIdx + 1} must have a title.`);
        }
      });
      (p.assignments || []).forEach((a, aIdx) => {
        if (!a.title || a.title.trim().length === 0) {
          errors.push(`Phase ${pNum}, Assignment ${aIdx + 1} must have a title.`);
        }
        if (a.maxMarks < 1) {
          errors.push(`Phase ${pNum}, Assignment "${a.title || aIdx + 1}" max marks must be at least 1.`);
        }
        if (a.passMarks > a.maxMarks) {
          errors.push(`Phase ${pNum}, Assignment "${a.title}" pass marks (${a.passMarks}) cannot exceed max marks (${a.maxMarks}).`);
        }
        if (a.passMarks < 0) {
          errors.push(`Phase ${pNum}, Assignment "${a.title}" pass marks cannot be negative.`);
        }
      });
      if (p.exam && p.exam.enabled) {
        if (p.exam.maxMarks < 1) {
          errors.push(`Phase ${pNum} exam max marks must be at least 1.`);
        }
        if (p.exam.passMarks > p.exam.maxMarks) {
          errors.push(`Phase ${pNum} exam pass marks cannot exceed max marks.`);
        }
      }
    });

    if (form.completionPolicy?.reEnrollment?.discountEnabled) {
      const disc = form.completionPolicy.reEnrollment.discountPercentage;
      if (disc < 0 || disc > 100) {
        errors.push('Re-enrollment discount must be between 0% and 100%.');
      }
    }

    return errors;
  };

  const handleSaveDraft = async () => {
    const errs = validateForm(false);
    if (errs.length > 0) {
      showToast(errs[0], 'error');
      return;
    }

    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const payload = {
        name: form.name.trim(),
        course_type: form.course_type,
        description: form.description,
        duration_value: form.duration.value,
        duration_unit: form.duration.unit,
        phase_count: form.phaseCount,
        phases: form.phases,
        completionPolicy: form.completionPolicy
      };

      const url = editingDefId ? `${API_BASE}/${editingDefId}` : API_BASE;
      const method = editingDefId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save draft course');
      }

      // Clear local unsaved draft
      const storageKey = getDraftStorageKey(currentUserId);
      localStorage.removeItem(storageKey);
      baselineFormJsonRef.current = JSON.stringify(form);
      setIsDirty(false);
      setHasUnsavedDraftInStorage(false);

      showToast('Course draft saved successfully!');
      fetchCourses();
      syncUrl('list', null, null);
      setViewMode('list');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async (courseIdToPublish = null) => {
    const targetId = courseIdToPublish || editingDefId;

    if (!targetId) {
      // Must save draft first if new
      const errs = validateForm(true);
      if (errs.length > 0) {
        showToast(errs[0], 'error');
        return;
      }
      try {
        setLoading(true);
        const token = localStorage.getItem('token');
        const payload = {
          name: form.name.trim(),
          course_type: form.course_type,
          description: form.description,
          duration_value: form.duration.value,
          duration_unit: form.duration.unit,
          phase_count: form.phaseCount,
          phases: form.phases,
          completionPolicy: form.completionPolicy
        };
        const createRes = await fetch(API_BASE, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(createData.error || 'Failed to create draft');

        // Now publish
        const pubRes = await fetch(`${API_BASE}/${createData.definition.id}/publish`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
        const pubData = await pubRes.json();
        if (!pubRes.ok) throw new Error(pubData.error || 'Failed to publish');

        // Clear local unsaved draft
        const storageKey = getDraftStorageKey(currentUserId);
        localStorage.removeItem(storageKey);
        setIsDirty(false);
        setHasUnsavedDraftInStorage(false);

        showToast('Course published successfully! Structure is now locked.');
        fetchCourses();
        syncUrl('list', null, null);
        setViewMode('list');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Existing targetId
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/${targetId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to publish course');

      // Clear local unsaved draft
      const storageKey = getDraftStorageKey(currentUserId);
      localStorage.removeItem(storageKey);
      baselineFormJsonRef.current = JSON.stringify(form);
      setIsDirty(false);
      setHasUnsavedDraftInStorage(false);

      showToast('Course definition published successfully!');
      fetchCourses();
      syncUrl('list', null, null);
      setViewMode('list');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const parseDefObject = (courseDef) => {
    if (!courseDef) return {};
    if (courseDef.definition && typeof courseDef.definition === 'object') {
      return courseDef.definition;
    }
    if (courseDef.definition_json) {
      try {
        return typeof courseDef.definition_json === 'string'
          ? JSON.parse(courseDef.definition_json)
          : courseDef.definition_json;
      } catch (err) {
        console.error('Failed to parse definition_json:', err);
      }
    }
    return {};
  };

  // Open Routine Audit Modal
  const openRoutineAuditModal = async (courseDef) => {
    try {
      setAuditModalDef(courseDef);
      const parsed = parseDefObject(courseDef);
      const firstPhase = parsed.phases?.[0];
      setAuditSelectedPhaseId(firstPhase?.id || 'phase_1');
      setAuditRoutineList(firstPhase?.routine || []);
      setAuditReason('');
      setAuditLoading(true);

      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/${courseDef.id}/routine-audits`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAuditHistory(Array.isArray(data) ? data : (data.audits || []));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleAuditPhaseChange = (phaseId) => {
    setAuditSelectedPhaseId(phaseId);
    if (auditModalDef) {
      try {
        const parsed = parseDefObject(auditModalDef);
        const p = parsed.phases?.find(ph => ph.id === phaseId);
        setAuditRoutineList(p?.routine || []);
      } catch (err) {
        console.error('Failed to parse definition routine in audit modal:', err);
      }
    }
  };

  const handleSaveRoutineChange = async () => {
    if (!auditReason.trim()) {
      showToast('Please provide an audit reason for changing the routine.', 'error');
      return;
    }

    try {
      setAuditLoading(true);
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/${auditModalDef.id}/routine`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phase_id: auditSelectedPhaseId,
          routine: auditRoutineList,
          reason: auditReason.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update routine');

      showToast('Routine updated and recorded in audit log!');
      fetchCourses();
      setAuditModalDef(null);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setAuditLoading(false);
    }
  };

  return (
    <div className="page-container container cm-container">
      {/* Toast Notification */}
      {toast && (
        <div className={`cm-toast cm-toast--${toast.type === 'error' ? 'error' : 'success'}`}>
          {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="cm-header">
        <div className="cm-header-brand">
          <div className="cm-header-icon">
            <Layers size={26} />
          </div>
          <div className="cm-header-titles">
            <h1 className="cm-header-title">
              Course Maker
            </h1>
            <p className="cm-header-subtitle">
              Design courses and workshops with 1–5 customizable phases, routines, grading, and completion rules.
            </p>
          </div>
        </div>

        {viewMode === 'list' ? (
          <div className="cm-header-actions">
            <button
              onClick={startNewCourse}
              className="cm-btn cm-btn-primary"
            >
              <Plus size={18} /> Create New Course
            </button>
          </div>
        ) : (
          <div className="cm-header-actions">
            {/* Persistence Status Indicator */}
            <div className="cm-persistence-status">
              {isDirty ? (
                <span className="cm-status-pill cm-status-pill--unsaved" title="Unsaved changes in this session">
                  <span className="cm-status-dot cm-status-dot--unsaved" />
                  Unsaved Changes {lastSavedTime ? `(${lastSavedTime})` : ''}
                </span>
              ) : (
                <span className="cm-status-pill cm-status-pill--saved" title="All changes saved to server">
                  <CheckCircle2 size={14} />
                  Saved
                </span>
              )}
            </div>

            {isDirty && (
              <button
                type="button"
                onClick={() => setShowDiscardModal(true)}
                className="cm-btn cm-btn-secondary cm-btn-sm cm-btn-discard"
                title="Discard all unsaved edits"
              >
                <Trash2 size={15} /> Discard Draft
              </button>
            )}

            <button
              onClick={() => {
                if (viewMode === 'review') {
                  setViewMode('builder');
                  syncUrl('builder', editingDefId, activePhaseTab);
                } else {
                  setViewMode('list');
                  syncUrl('list', null, null);
                }
              }}
              className="cm-btn cm-btn-secondary"
            >
              <ArrowLeft size={16} /> {viewMode === 'review' ? 'Back to Editor' : 'Course Catalog'}
            </button>
            {viewMode === 'builder' && (
              <button
                onClick={() => {
                  setViewMode('review');
                  syncUrl('review', editingDefId, activePhaseTab);
                }}
                className="cm-btn cm-btn-primary"
              >
                Review & Publish <ArrowRight size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── VIEW 1: COURSES LIST ── */}
      {viewMode === 'list' && (
        <div>
          {hasUnsavedDraftInStorage && (
            <div className="cm-unsaved-banner">
              <div className="cm-unsaved-banner-content">
                <AlertCircle size={20} className="cm-unsaved-banner-icon" />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    You have an unsaved course draft in progress.
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Restored from your active browser session.
                  </div>
                </div>
              </div>
              <div className="cm-unsaved-banner-actions">
                <button
                  type="button"
                  onClick={resumeUnsavedDraft}
                  className="cm-btn cm-btn-secondary cm-btn-sm"
                >
                  Resume Editing
                </button>
                <button
                  type="button"
                  onClick={() => setShowDiscardModal(true)}
                  className="cm-btn cm-btn-secondary cm-btn-sm cm-btn-discard"
                  title="Discard Draft"
                  aria-label="Discard Draft"
                >
                  <Trash2 size={15} /> Discard
                </button>
              </div>
            </div>
          )}
          {courses.length === 0 && !loading ? (
            <div className="cm-catalog-empty">
              <BookOpen size={48} style={{ opacity: 0.4, marginBottom: '1rem' }} />
              <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No Course Definitions Yet</h3>
              <p style={{ maxWidth: '420px', margin: '0 auto 1.5rem', fontSize: '0.9rem' }}>
                Create structured multi-phase courses or workshops with dynamic classes, custom routines, assignments, and automated certificate eligibility.
              </p>
              <button
                onClick={startNewCourse}
                className="cm-btn cm-btn-primary"
              >
                Start Your First Course
              </button>
            </div>
          ) : (
            <div className="cm-catalog-grid">
              {courses.map((course) => {
                const parsedDef = parseDefObject(course);
                const isPub = course.status === 'published';

                return (
                  <div
                    key={course.id}
                    className="cm-catalog-card"
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                        <span className={`cm-course-badge ${isPub ? 'cm-course-badge--published' : 'cm-course-badge--draft'}`}>
                          {isPub ? 'Published' : 'Draft'} • v{course.version}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {course.phase_count} {course.phase_count === 1 ? 'Phase' : 'Phases'}
                        </span>
                      </div>

                      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.5rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                        {course.name}
                      </h3>
                      <p style={{
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                        margin: 0,
                        lineHeight: '1.4',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}>
                        {course.description || parsedDef.basics?.description || 'No description provided.'}
                      </p>
                    </div>

                    {isPub && (
                      <div className="cm-catalog-batches-section">
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '0.65rem',
                          flexWrap: 'wrap',
                          gap: '0.5rem'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Layers size={16} style={{ color: 'var(--accent-primary)' }} />
                            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                              Batches ({course.batches?.length || 0})
                            </span>
                            <span className="cm-badge-enrolled">
                              {course.total_students || 0} Enrolled
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setCreateBatchTargetCourse(course);
                              setShowBatchModal(true);
                            }}
                            className="cm-btn cm-btn-secondary cm-btn-sm"
                            style={{
                              padding: '8px 14px',
                              minHeight: '44px',
                              minWidth: '44px',
                              fontSize: '0.8rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                            title={`Create a new batch for ${course.name}`}
                          >
                            <Plus size={14} /> Create Batch
                          </button>
                        </div>

                        {course.batches && course.batches.length > 0 ? (
                          <div className="cm-catalog-batches-list" style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem',
                            maxHeight: '220px',
                            overflowY: 'auto',
                            paddingRight: '4px'
                          }}>
                            {course.batches.map(b => (
                              <div
                                key={b.id}
                                className="cm-catalog-batch-item"
                              >
                                <div style={{ minWidth: '140px', flex: '1 1 auto' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                      {b.batch_name || `Batch ${b.batch_number}`}
                                    </span>
                                    <span className={`cm-batch-status-badge cm-batch-status--${b.status}`}>
                                      {b.status}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    {b.start_date ? `${b.start_date}${b.end_date ? ' to ' + b.end_date : ''}` : 'Dates pending'} • {b.student_count || 0} students
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => navigate(`/admin/batchmanager/${b.slug || b.id}`)}
                                  className="cm-btn cm-btn-secondary cm-btn-sm"
                                  style={{
                                    padding: '8px 12px',
                                    fontSize: '0.8rem',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    minHeight: '44px',
                                    minWidth: '44px'
                                  }}
                                  title={`Manage ${b.batch_name}`}
                                >
                                  Manage <ArrowRight size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="cm-catalog-batch-empty">
                            No batches created yet. Click "Create Batch" above to launch a batch for this course.
                          </div>
                        )}
                      </div>
                    )}

                    <div className="cm-catalog-card-footer">
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Type: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{getCourseTypeLabel(course.course_type)}</span>
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {!isPub ? (
                          <>
                            <button
                              onClick={() => editDraftCourse(course)}
                              className="cm-btn cm-btn-secondary cm-btn-sm"
                            >
                              <Edit3 size={14} /> Edit
                            </button>
                            <button
                              onClick={() => handlePublish(course.id)}
                              className="cm-btn cm-btn-primary cm-btn-sm"
                            >
                              Publish
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setCreateBatchTargetCourse(course);
                                setShowBatchModal(true);
                              }}
                              className="cm-btn cm-btn-primary cm-btn-sm"
                              style={{
                                minHeight: '44px',
                                minWidth: '44px'
                              }}
                            >
                              <Plus size={14} /> Create Batch
                            </button>
                            <button
                              onClick={() => openRoutineAuditModal(course)}
                              className="cm-btn cm-btn-secondary cm-btn-sm"
                            >
                              <History size={14} /> Routine & Audits
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── VIEW 2: COURSE BUILDER (1–5 PHASES) ── */}
      {viewMode === 'builder' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Section A: Course Basics */}
          <div className="cm-card">
            <h2 className="cm-section-title">
              <BookOpen size={20} color="var(--accent-primary)" /> 1. Course Basics
            </h2>

            <div className="cm-basics-grid">
              <div>
                <label className="cm-label">
                  Course Title *
                </label>
                <input
                  type="text"
                  className="cm-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Masterclass in Directing & Acting"
                />
              </div>

              <div>
                <label className="cm-label">
                  Course Type *
                </label>
                <select
                  className="cm-select"
                  value={form.course_type}
                  onChange={(e) => setForm({ ...form, course_type: e.target.value })}
                >
                  {COURSE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="cm-label">
                  Course Duration
                </label>
                <div className="cm-duration-group">
                  <input
                    type="number"
                    min="1"
                    className="cm-input"
                    style={{ width: '80px', minWidth: '70px' }}
                    value={form.duration.value}
                    onChange={(e) => setForm({
                      ...form,
                      duration: { ...form.duration, value: parseInt(e.target.value, 10) || 1 }
                    })}
                  />
                  <select
                    className="cm-select"
                    value={form.duration.unit}
                    onChange={(e) => setForm({
                      ...form,
                      duration: { ...form.duration, unit: e.target.value }
                    })}
                  >
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="cm-label">
                  Phase Count (1–5 Phases) *
                </label>
                <div className="cm-phase-count-group">
                  {[1, 2, 3, 4, 5].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => handlePhaseCountChange(cnt)}
                      className={`cm-phase-count-btn ${form.phaseCount === cnt ? 'active' : ''}`}
                    >
                      {cnt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1.25rem' }}>
              <label className="cm-label">
                Course Overview & Objectives
              </label>
              <textarea
                rows={2}
                className="cm-textarea"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief summary of skills, techniques, and final project requirements."
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          {/* Section B: Phase Navigation Tabs */}
          <div className="cm-phase-nav-container">
            <div className="cm-phase-nav-header">
              <span className="cm-phase-nav-label">
                Phase {activePhaseTab + 1} of {form.phases.length}
              </span>
              {form.phases.length > 1 && (
                <span className="cm-phase-nav-scroll-hint" aria-hidden="true">
                  ← Scroll for more phases →
                </span>
              )}
            </div>
            <div className="cm-phase-tabs-wrapper">
              <div 
                className="cm-phase-tabs"
                role="tablist"
                aria-label="Course phases"
              >
                {form.phases.map((phase, pIdx) => (
                  <button
                    key={phase.id || pIdx}
                    ref={el => { phaseTabRefs.current[pIdx] = el; }}
                    type="button"
                    role="tab"
                    id={`phase-tab-${pIdx}`}
                    aria-controls={`phase-panel-${pIdx}`}
                    aria-selected={activePhaseTab === pIdx}
                    tabIndex={activePhaseTab === pIdx ? 0 : -1}
                    onClick={() => switchPhaseTab(pIdx)}
                    onKeyDown={(e) => handlePhaseTabKeyDown(e, pIdx)}
                    className={`cm-phase-tab ${activePhaseTab === pIdx ? 'active' : ''}`}
                  >
                    <span>Phase {pIdx + 1}: {phase.title || 'Untitled'}</span>
                    <span className="cm-phase-tab-badge">
                      {(phase.classes || []).length} cls
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section C: Active Phase Configuration */}
          {form.phases[activePhaseTab] && (() => {
            const curPhase = form.phases[activePhaseTab];
            const pNum = activePhaseTab + 1;

            return (
              <div
                className="cm-card"
                role="tabpanel"
                id={`phase-panel-${activePhaseTab}`}
                aria-labelledby={`phase-tab-${activePhaseTab}`}
                style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}
              >
                {/* 1. Phase Header Details */}
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 1rem', color: 'var(--text-primary)' }}>
                    Phase {pNum} Configuration
                  </h3>

                  <div className="cm-phase-header-grid">
                    <div>
                      <label className="cm-label">
                        Phase Name / Title *
                      </label>
                      <input
                        type="text"
                        className="cm-input cm-phase-title-input"
                        value={curPhase.title}
                        onChange={(e) => updateCurrentPhase({ title: e.target.value })}
                        placeholder={`e.g. Phase ${pNum}: Screenwriting & Pre-production`}
                      />
                    </div>

                    <div>
                      <label className="cm-label">
                        Phase Duration
                      </label>
                      <div className="cm-duration-group">
                        <input
                          type="number"
                          min="1"
                          className="cm-input"
                          style={{ width: '80px', minWidth: '70px' }}
                          value={curPhase.duration?.value || 4}
                          onChange={(e) => updateCurrentPhase({
                            duration: { ...curPhase.duration, value: parseInt(e.target.value, 10) || 1 }
                          })}
                        />
                        <select
                          className="cm-select"
                          value={curPhase.duration?.unit || 'weeks'}
                          onChange={(e) => updateCurrentPhase({
                            duration: { ...curPhase.duration, unit: e.target.value }
                          })}
                        >
                          <option value="weeks">Weeks</option>
                          <option value="months">Months</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="cm-label">
                        Attendance Criteria
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minHeight: '44px', flexWrap: 'wrap' }}>
                        <label className="cm-checkbox-label">
                          <input
                            type="checkbox"
                            className="cm-checkbox"
                            checked={curPhase.requirements?.attendanceRequired !== false}
                            onChange={(e) => updateCurrentPhase({
                              requirements: { ...curPhase.requirements, attendanceRequired: e.target.checked }
                            })}
                          />
                          Require Min %:
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          disabled={curPhase.requirements?.attendanceRequired === false}
                          value={curPhase.requirements?.minAttendancePercent || 75}
                          onChange={(e) => updateCurrentPhase({
                            requirements: { ...curPhase.requirements, minAttendancePercent: parseInt(e.target.value, 10) || 0 }
                          })}
                          className="cm-input"
                          style={{ width: '70px', padding: '0.4rem 0.6rem', minHeight: '44px' }}
                        />
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>%</span>
                      </div>

                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Min Shooting Sessions:</span>
                          <input
                            type="number"
                            min="0"
                            value={curPhase.requirements?.categoryRequirements?.shooting?.minAttended ?? (typeof curPhase.requirements?.categoryRequirements?.shooting === 'number' ? curPhase.requirements.categoryRequirements.shooting : 0)}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10) || 0;
                              updateCurrentPhase({
                                requirements: {
                                  ...curPhase.requirements,
                                  categoryRequirements: {
                                    ...(curPhase.requirements?.categoryRequirements || {}),
                                    shooting: { minAttended: val }
                                  }
                                }
                              });
                            }}
                            className="cm-input"
                            style={{ width: '65px', padding: '0.35rem 0.5rem', minHeight: '44px' }}
                          />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Min Editing Sessions:</span>
                          <input
                            type="number"
                            min="0"
                            value={curPhase.requirements?.categoryRequirements?.editing?.minAttended ?? (typeof curPhase.requirements?.categoryRequirements?.editing === 'number' ? curPhase.requirements.categoryRequirements.editing : 0)}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10) || 0;
                              updateCurrentPhase({
                                requirements: {
                                  ...curPhase.requirements,
                                  categoryRequirements: {
                                    ...(curPhase.requirements?.categoryRequirements || {}),
                                    editing: { minAttended: val }
                                  }
                                }
                              });
                            }}
                            className="cm-input"
                            style={{ width: '65px', padding: '0.35rem 0.5rem', minHeight: '44px' }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Weekly Class Routine */}
                <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1.25rem' }}>
                  <div className="cm-routine-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Calendar size={18} color="var(--accent-primary)" />
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Weekly Class Routine
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={addRoutineToPhase}
                      className="cm-btn cm-btn-secondary cm-btn-sm"
                    >
                      <Plus size={14} /> Add Day / Time
                    </button>
                  </div>

                  {(curPhase.routine || []).length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, fontStyle: 'italic' }}>
                      No weekly routine set. Click "Add Day / Time" to define scheduled class times.
                    </p>
                  ) : (
                    <div className="cm-routine-slots">
                      {curPhase.routine.map((rt, rIdx) => (
                        <div
                          key={rIdx}
                          className="cm-routine-slot"
                        >
                          <div className="cm-routine-slot-row">
                            <select
                              value={rt.weekday}
                              onChange={(e) => updateRoutineField(rIdx, 'weekday', e.target.value)}
                              className="cm-select"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                fontWeight: 600,
                                fontSize: '0.85rem',
                                width: 'auto',
                                minHeight: '44px',
                                padding: '2px 4px'
                              }}
                            >
                              {WEEKDAYS.map(w => (
                                <option key={w} value={w}>{w}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => removeRoutineFromPhase(rIdx)}
                              className="cm-btn-danger-icon"
                              title="Remove Slot"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%' }}>
                            <input
                              type="time"
                              value={rt.startTime}
                              onChange={(e) => updateRoutineField(rIdx, 'startTime', e.target.value)}
                              className="cm-routine-time-input"
                              style={{ flex: 1 }}
                            />
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>to</span>
                            <input
                              type="time"
                              value={rt.endTime}
                              onChange={(e) => updateRoutineField(rIdx, 'endTime', e.target.value)}
                              className="cm-routine-time-input"
                              style={{ flex: 1 }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. Dynamic Classes */}
                <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Clock size={18} color="var(--accent-primary)" />
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Phase Classes ({(curPhase.classes || []).length})
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={addClassToPhase}
                      className="cm-btn cm-btn-secondary cm-btn-sm"
                    >
                      <Plus size={14} /> Add Class
                    </button>
                  </div>

                  <div className="cm-classes-list">
                    {(curPhase.classes || []).map((cls, cIdx) => (
                      <div
                        key={cls.id || cIdx}
                        className="cm-class-card"
                      >
                        <div>
                          <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                            Class Title *
                          </label>
                          <input
                            type="text"
                            value={cls.title}
                            onChange={(e) => updateClassField(cls.id, 'title', e.target.value)}
                            placeholder="e.g. Master Shot & Reverse Angles"
                            className="cm-input"
                            style={{ minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                          />
                        </div>

                        <div>
                          <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                            Subject
                          </label>
                          <input
                            type="text"
                            list="subject-suggestions"
                            value={cls.subjectName}
                            onChange={(e) => updateClassField(cls.id, 'subjectName', e.target.value)}
                            placeholder="Select or enter subject"
                            className="cm-input"
                            style={{ minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                          />
                          <datalist id="subject-suggestions">
                            {subjects.map(s => <option key={s.id || s.name} value={s.name} />)}
                          </datalist>
                        </div>

                        <div>
                          <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                            Teacher
                          </label>
                          <input
                            type="text"
                            list="teacher-suggestions"
                            value={cls.teacherName}
                            onChange={(e) => updateClassField(cls.id, 'teacherName', e.target.value)}
                            placeholder="Select or enter teacher"
                            className="cm-input"
                            style={{ minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                          />
                          <datalist id="teacher-suggestions">
                            {teachers.map(t => <option key={t.id} value={t.full_name || `${t.first_name} ${t.last_name}`} />)}
                          </datalist>
                        </div>

                        <div>
                          <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                            Mode & Category
                          </label>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <select
                              value={cls.deliveryMode}
                              onChange={(e) => updateClassField(cls.id, 'deliveryMode', e.target.value)}
                              className="cm-select"
                              style={{ flex: 1, minHeight: '44px', padding: '0.45rem 0.4rem', fontSize: '0.8rem' }}
                            >
                              {DELIVERY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                            <select
                              value={cls.category || 'theory'}
                              onChange={(e) => updateClassField(cls.id, 'category', e.target.value)}
                              className="cm-select"
                              style={{ flex: 1, minHeight: '44px', padding: '0.45rem 0.4rem', fontSize: '0.8rem' }}
                            >
                              {CLASS_CATEGORIES.map(cat => <option key={cat.value} value={cat.value}>{cat.label}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="cm-class-actions">
                          <label className="cm-checkbox-label" style={{ fontSize: '0.8rem' }}>
                            <input
                              type="checkbox"
                              className="cm-checkbox"
                              checked={cls.mandatory !== false}
                              onChange={(e) => updateClassField(cls.id, 'mandatory', e.target.checked)}
                            />
                            Mandatory
                          </label>
                          <button
                            type="button"
                            onClick={() => removeClassFromPhase(cls.id)}
                            className="cm-btn-danger-icon"
                            title="Delete Class"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4. Assignments */}
                <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <FileText size={18} color="var(--accent-primary)" />
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Phase Assignments ({(curPhase.assignments || []).length})
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={addAssignmentToPhase}
                      className="cm-btn cm-btn-secondary cm-btn-sm"
                    >
                      <Plus size={14} /> Add Assignment
                    </button>
                  </div>

                  <div className="cm-assignments-list">
                    {(curPhase.assignments || []).map((asg, aIdx) => (
                      <div
                        key={asg.id || aIdx}
                        className="cm-assignment-card"
                      >
                        <div>
                          <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                            Assignment Title *
                          </label>
                          <input
                            type="text"
                            value={asg.title}
                            onChange={(e) => updateAssignmentField(asg.id, 'title', e.target.value)}
                            placeholder="e.g. 1-Minute Scene Exercise"
                            className="cm-input"
                            style={{ minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                          />
                        </div>

                        <div>
                          <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                            Subject
                          </label>
                          <input
                            type="text"
                            list="asg-subject-suggestions"
                            value={asg.subject || ''}
                            onChange={(e) => updateAssignmentField(asg.id, 'subject', e.target.value)}
                            placeholder="Select or enter subject"
                            className="cm-input"
                            style={{ minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                          />
                          <datalist id="asg-subject-suggestions">
                            {subjects.map(s => <option key={s.id || s.name} value={s.name} />)}
                          </datalist>
                        </div>

                        <div>
                          <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                            Instructions / Remarks
                          </label>
                          <input
                            type="text"
                            value={asg.instructions}
                            onChange={(e) => updateAssignmentField(asg.id, 'instructions', e.target.value)}
                            placeholder="Instructions for student"
                            className="cm-input"
                            style={{ minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                          />
                        </div>

                        <div className="cm-marks-group">
                          <div>
                            <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                              Max Marks
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={asg.maxMarks}
                              onChange={(e) => updateAssignmentField(asg.id, 'maxMarks', parseFloat(e.target.value) || 0)}
                              className="cm-input"
                              style={{ width: '70px', minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div>
                            <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                              Pass Marks
                            </label>
                            <input
                              type="number"
                              min="0"
                              value={asg.passMarks}
                              onChange={(e) => updateAssignmentField(asg.id, 'passMarks', parseFloat(e.target.value) || 0)}
                              className="cm-input"
                              style={{ width: '70px', minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                            />
                          </div>
                        </div>

                        <div className="cm-assignment-actions">
                          <label className="cm-checkbox-label" style={{ fontSize: '0.8rem' }}>
                            <input
                              type="checkbox"
                              className="cm-checkbox"
                              checked={asg.submissionRequired !== false}
                              onChange={(e) => updateAssignmentField(asg.id, 'submissionRequired', e.target.checked)}
                            />
                            Required
                          </label>
                          <button
                            type="button"
                            onClick={() => removeAssignmentFromPhase(asg.id)}
                            className="cm-btn-danger-icon"
                            title="Delete Assignment"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. Phase Exam (Optional) */}
                <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <label className="cm-checkbox-label">
                      <input
                        type="checkbox"
                        className="cm-checkbox"
                        checked={curPhase.exam?.enabled || false}
                        onChange={(e) => updateCurrentPhase({
                          exam: { ...curPhase.exam, enabled: e.target.checked }
                        })}
                      />
                      <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Enable Phase Final Exam / Evaluation
                      </span>
                    </label>
                  </div>

                  {curPhase.exam?.enabled && (
                    <div className="cm-exam-grid">
                      <div>
                        <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                          Exam Title
                        </label>
                        <input
                          type="text"
                          value={curPhase.exam.title || ''}
                          onChange={(e) => updateCurrentPhase({
                            exam: { ...curPhase.exam, title: e.target.value }
                          })}
                          placeholder="e.g. Midterm Written Assessment"
                          className="cm-input"
                          style={{ minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                        />
                      </div>

                      <div>
                        <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                          Exam Type
                        </label>
                        <select
                          value={curPhase.exam.type || 'written'}
                          onChange={(e) => updateCurrentPhase({
                            exam: { ...curPhase.exam, type: e.target.value }
                          })}
                          className="cm-select"
                          style={{ minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                        >
                          <option value="written">Written Exam</option>
                          <option value="viva">Viva / Oral Defense</option>
                          <option value="practical">Practical Production Test</option>
                          <option value="mcq">MCQ / Quiz</option>
                        </select>
                      </div>

                      <div className="cm-marks-group">
                        <div>
                          <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                            Max Marks
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={curPhase.exam.maxMarks || 80}
                            onChange={(e) => updateCurrentPhase({
                              exam: { ...curPhase.exam, maxMarks: parseFloat(e.target.value) || 0 }
                            })}
                            className="cm-input"
                            style={{ width: '80px', minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                          />
                        </div>
                        <div>
                          <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                            Pass Marks
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={curPhase.exam.passMarks || 35}
                            onChange={(e) => updateCurrentPhase({
                              exam: { ...curPhase.exam, passMarks: parseFloat(e.target.value) || 0 }
                            })}
                            className="cm-input"
                            style={{ width: '80px', minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="cm-label" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                          Overall Phase Pass Threshold
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={curPhase.exam.phasePassThreshold || 50}
                          onChange={(e) => updateCurrentPhase({
                            exam: { ...curPhase.exam, phasePassThreshold: parseFloat(e.target.value) || 0 }
                          })}
                          placeholder="Min total marks"
                          className="cm-input"
                          style={{ minHeight: '44px', padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Section D: Completion Policy & Re-Enrollment Rules */}
          <div className="cm-card">
            <h2 className="cm-section-title">
              <Award size={20} color="var(--accent-primary)" /> 3. Certificate & Re-Enrollment Policy
            </h2>

            <div className="cm-policy-grid">
              {/* Certificate Rules */}
              <div className="cm-card-subtle">
                <h4 style={{ margin: '0 0 0.85rem', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Certificate Eligibility Criteria
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <label className="cm-checkbox-label">
                    <input
                      type="checkbox"
                      className="cm-checkbox"
                      checked={form.completionPolicy?.certificateEligibility?.allRequiredPhasesPassed !== false}
                      onChange={(e) => setForm({
                        ...form,
                        completionPolicy: {
                          ...form.completionPolicy,
                          certificateEligibility: {
                            ...form.completionPolicy.certificateEligibility,
                            allRequiredPhasesPassed: e.target.checked
                          }
                        }
                      })}
                    />
                    Student must pass all required phases (1 to {form.phaseCount})
                  </label>

                  <label className="cm-checkbox-label">
                    <input
                      type="checkbox"
                      className="cm-checkbox"
                      checked={form.completionPolicy?.certificateEligibility?.requireAllMandatoryClasses !== false}
                      onChange={(e) => setForm({
                        ...form,
                        completionPolicy: {
                          ...form.completionPolicy,
                          certificateEligibility: {
                            ...form.completionPolicy.certificateEligibility,
                            requireAllMandatoryClasses: e.target.checked
                          }
                        }
                      })}
                    />
                    Must attend 100% of mandatory classes
                  </label>

                  <label className="cm-checkbox-label">
                    <input
                      type="checkbox"
                      className="cm-checkbox"
                      checked={form.completionPolicy?.certificateEligibility?.requireAllMandatoryAssignments !== false}
                      onChange={(e) => setForm({
                        ...form,
                        completionPolicy: {
                          ...form.completionPolicy,
                          certificateEligibility: {
                            ...form.completionPolicy.certificateEligibility,
                            requireAllMandatoryAssignments: e.target.checked
                          }
                        }
                      })}
                    />
                    Must submit & pass all mandatory assignments
                  </label>

                  <label className="cm-checkbox-label">
                    <input
                      type="checkbox"
                      className="cm-checkbox"
                      checked={form.completionPolicy?.certificateEligibility?.requireFeesPaid !== false}
                      onChange={(e) => setForm({
                        ...form,
                        completionPolicy: {
                          ...form.completionPolicy,
                          certificateEligibility: {
                            ...form.completionPolicy.certificateEligibility,
                            requireFeesPaid: e.target.checked
                          }
                        }
                      })}
                    />
                    Require all phase fees to be fully paid
                  </label>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Min Overall Attendance:</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={form.completionPolicy?.certificateEligibility?.minOverallAttendance ?? 75}
                      onChange={(e) => setForm({
                        ...form,
                        completionPolicy: {
                          ...form.completionPolicy,
                          certificateEligibility: {
                            ...form.completionPolicy.certificateEligibility,
                            minOverallAttendance: parseInt(e.target.value, 10) || 0
                          }
                        }
                      })}
                      className="cm-input"
                      style={{ width: '65px', padding: '0.35rem 0.5rem', minHeight: '44px' }}
                    />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>%</span>
                  </div>
                </div>
              </div>

              {/* Phase Progression Gates */}
              <div className="cm-card-subtle">
                <h4 style={{ margin: '0 0 0.85rem', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Phase Progression Gates
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <label className="cm-checkbox-label">
                    <input
                      type="checkbox"
                      className="cm-checkbox"
                      checked={form.completionPolicy?.phaseGates?.sequentialProgression !== false}
                      onChange={(e) => setForm({
                        ...form,
                        completionPolicy: {
                          ...form.completionPolicy,
                          phaseGates: {
                            ...(form.completionPolicy.phaseGates || {}),
                            sequentialProgression: e.target.checked
                          }
                        }
                      })}
                    />
                    Sequential progression (Phases unlocked in order)
                  </label>

                  <label className="cm-checkbox-label">
                    <input
                      type="checkbox"
                      className="cm-checkbox"
                      checked={form.completionPolicy?.phaseGates?.requirePreviousPhasePassed !== false}
                      onChange={(e) => setForm({
                        ...form,
                        completionPolicy: {
                          ...form.completionPolicy,
                          phaseGates: {
                            ...(form.completionPolicy.phaseGates || {}),
                            requirePreviousPhasePassed: e.target.checked
                          }
                        }
                      })}
                    />
                    Require previous phase passed before advancing
                  </label>

                  <label className="cm-checkbox-label">
                    <input
                      type="checkbox"
                      className="cm-checkbox"
                      checked={!!form.completionPolicy?.phaseGates?.requirePreviousPhaseFeesPaid}
                      onChange={(e) => setForm({
                        ...form,
                        completionPolicy: {
                          ...form.completionPolicy,
                          phaseGates: {
                            ...(form.completionPolicy.phaseGates || {}),
                            requirePreviousPhaseFeesPaid: e.target.checked
                          }
                        }
                      })}
                    />
                    Require previous phase fees paid before advancing
                  </label>
                </div>
              </div>

              {/* Failure & Re-Enrollment Rules */}
              <div className="cm-card-subtle">
                <h4 style={{ margin: '0 0 0.85rem', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Re-Enrollment & Failure Policy
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <label className="cm-checkbox-label">
                    <input
                      type="checkbox"
                      className="cm-checkbox"
                      checked={form.completionPolicy?.reEnrollment?.discountEnabled !== false}
                      onChange={(e) => setForm({
                        ...form,
                        completionPolicy: {
                          ...form.completionPolicy,
                          reEnrollment: {
                            ...form.completionPolicy.reEnrollment,
                            discountEnabled: e.target.checked
                          }
                        }
                      })}
                    />
                    Allow discount for re-enrolling after failure / retake
                  </label>

                  {form.completionPolicy?.reEnrollment?.discountEnabled !== false && (
                    <div className="cm-discount-row">
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Discount Percentage:</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={form.completionPolicy?.reEnrollment?.discountPercentage ?? 50}
                        onChange={(e) => setForm({
                          ...form,
                          completionPolicy: {
                            ...form.completionPolicy,
                            reEnrollment: {
                              ...form.completionPolicy.reEnrollment,
                              discountPercentage: parseInt(e.target.value, 10) || 0
                            }
                          }
                        })}
                        className="cm-input"
                        style={{ width: '75px', minHeight: '44px', padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                      />
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>% (Default is 50%)</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Action Controls */}
          <div className="cm-actions-footer">
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleSaveDraft}
                className="cm-btn cm-btn-secondary"
              >
                Save as Draft
              </button>
              {isDirty && (
                <button
                  type="button"
                  onClick={() => setShowDiscardModal(true)}
                  className="cm-btn cm-btn-secondary cm-btn-discard"
                >
                  <Trash2 size={15} /> Discard Draft
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setViewMode('review');
                syncUrl('review', editingDefId, activePhaseTab);
              }}
              className="cm-btn cm-btn-primary"
            >
              Review Rules Before Publishing <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── VIEW 3: REVIEW & PUBLISH SCREEN ── */}
      {viewMode === 'review' && (
        <div className="cm-review-container">
          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '0 0 0.4rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
              Summary & Pre-Publish Review
            </h2>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Verify every phase, routine, class requirement, and grading policy. Once published, core course rules are locked to protect student academic history.
            </p>
          </div>

          {/* Validation Warnings / Errors */}
          {(() => {
            const errs = validateForm(true);
            if (errs.length > 0) {
              return (
                <div className="cm-validation-box">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                    <AlertCircle size={18} />
                    <span>Please correct the following issues before publishing:</span>
                  </div>
                  <ul style={{ margin: '0.25rem 0 0 1.25rem', fontSize: '0.85rem' }}>
                    {errs.map((e, idx) => <li key={idx}>{e}</li>)}
                  </ul>
                </div>
              );
            }
            return (
              <div className="cm-success-box">
                <CheckCircle2 size={18} />
                <span>All validation checks passed! This course specification is complete and ready to publish.</span>
              </div>
            );
          })()}

          {/* Course Spec Summary Card */}
          <div className="cm-card-subtle">
            <h3 style={{ fontSize: '1.15rem', fontWeight: 600, margin: '0 0 0.5rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
              {form.name || 'Untitled Course'}
            </h3>
            <div className="cm-review-meta">
              <span>Type: <strong style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>{form.course_type}</strong></span>
              <span>Duration: <strong style={{ color: 'var(--text-primary)' }}>{form.duration.value} {form.duration.unit}</strong></span>
              <span>Total Phases: <strong style={{ color: 'var(--text-primary)' }}>{form.phaseCount}</strong></span>
            </div>

            {/* Phases breakdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {form.phases.map((p, idx) => (
                <div
                  key={idx}
                  className="cm-card"
                  style={{ padding: '1rem' }}
                >
                  <div className="cm-review-phase-header">
                    <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--accent-primary)', wordBreak: 'break-word' }}>
                      Phase {idx + 1}: {p.title}
                    </h4>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {p.duration?.value} {p.duration?.unit} • Min {p.requirements?.minAttendancePercent || 75}% Attendance
                    </span>
                  </div>

                  <div className="cm-review-phase-stats">
                    <div>Classes: <strong style={{ color: 'var(--text-primary)' }}>{(p.classes || []).length}</strong> ({(p.classes || []).filter(c => c.mandatory).length} mandatory)</div>
                    <div>Assignments: <strong style={{ color: 'var(--text-primary)' }}>{(p.assignments || []).length}</strong></div>
                    <div>Exam: <strong style={{ color: 'var(--text-primary)' }}>{p.exam?.enabled ? `${p.exam.title} (${p.exam.maxMarks} marks, pass: ${p.exam.passMarks})` : 'None'}</strong></div>
                  </div>

                  {(p.assignments || []).length > 0 && (
                    <div style={{ marginTop: '0.65rem', paddingTop: '0.65rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.35rem', fontWeight: 600 }}>
                        Assignments &amp; Subjects:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {p.assignments.map((asg, aIdx) => (
                          <div
                            key={asg.id || aIdx}
                            className="cm-review-asg-row"
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{asg.title}</span>
                              {asg.subject ? (
                                <span className="cm-review-subject-badge">
                                  {asg.subject}
                                </span>
                              ) : null}
                            </div>
                            <span style={{ color: 'var(--text-secondary)' }}>
                              Max {asg.maxMarks} pts (Pass: {asg.passMarks} pts) {asg.submissionRequired ? '• Required' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Certificate & Progression Policy summary */}
            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--glass-border)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Phase Progression Gates: </strong>
                {form.completionPolicy?.phaseGates?.sequentialProgression !== false ? 'Sequential order enforced' : 'Independent phases'} • {form.completionPolicy?.phaseGates?.requirePreviousPhasePassed !== false ? 'Must pass previous phase' : 'Pass not required'} • {form.completionPolicy?.phaseGates?.requirePreviousPhaseFeesPaid ? 'Fees must be paid before advance' : 'Fee gate disabled'}
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Certificate Criteria: </strong>
                {form.completionPolicy?.certificateEligibility?.allRequiredPhasesPassed !== false ? 'All phases passed' : 'Phases optional'} • {form.completionPolicy?.certificateEligibility?.requireFeesPaid !== false ? 'All fees paid' : 'Fees optional'} • Min {form.completionPolicy?.certificateEligibility?.minOverallAttendance ?? 75}% overall attendance
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Re-enrollment Policy: </strong>
                {form.completionPolicy?.reEnrollment?.discountEnabled ? `${form.completionPolicy.reEnrollment.discountPercentage}% discount on failed attempt retake` : 'No retake discount'}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="cm-actions-footer">
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => {
                  setViewMode('builder');
                  syncUrl('builder', editingDefId, activePhaseTab);
                }}
                className="cm-btn cm-btn-secondary"
              >
                Back to Edit
              </button>
              <button
                type="button"
                onClick={handleSaveDraft}
                className="cm-btn cm-btn-secondary"
              >
                Save as Draft
              </button>
              {isDirty && (
                <button
                  type="button"
                  onClick={() => setShowDiscardModal(true)}
                  className="cm-btn cm-btn-secondary cm-btn-discard"
                >
                  <Trash2 size={15} /> Discard Draft
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => handlePublish()}
              disabled={validateForm(true).length > 0}
              className="cm-btn cm-btn-primary"
            >
              <Check size={18} /> Publish Course Definition
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL: ROUTINE EDITING & AUDIT LOGS ── */}
      {auditModalDef && typeof document !== 'undefined' && createPortal(
        <div className="cm-modal-overlay">
          <div className="cm-modal-dialog">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                  Manage Routine & Audit History
                </h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  {auditModalDef.name} (v{auditModalDef.version})
                </p>
              </div>
              <button
                onClick={() => setAuditModalDef(null)}
                className="cm-btn-danger-icon"
                style={{ color: 'var(--text-secondary)' }}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            {/* Phase Selector for Routine */}
            <div>
              <label className="cm-label">
                Select Phase:
              </label>
              <select
                value={auditSelectedPhaseId}
                onChange={(e) => handleAuditPhaseChange(e.target.value)}
                className="cm-select"
              >
                {(() => {
                  try {
                    const parsed = parseDefObject(auditModalDef);
                    return (parsed.phases || []).map((p, idx) => (
                      <option key={p.id || idx} value={p.id}>
                        Phase {idx + 1}: {p.title}
                      </option>
                    ));
                  } catch {
                    return null;
                  }
                })()}
              </select>
            </div>

            {/* Routine Slots */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Active Routine Slots</span>
                <button
                  type="button"
                  onClick={() => setAuditRoutineList([
                    ...auditRoutineList,
                    { weekday: 'Saturday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka' }
                  ])}
                  className="cm-btn cm-btn-secondary cm-btn-sm"
                >
                  + Add Slot
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {auditRoutineList.map((slot, sIdx) => (
                  <div key={sIdx} className="cm-modal-routine-slot">
                    <div className="cm-routine-slot-row">
                      <select
                        value={slot.weekday}
                        onChange={(e) => {
                          const updated = [...auditRoutineList];
                          updated[sIdx].weekday = e.target.value;
                          setAuditRoutineList(updated);
                        }}
                        className="cm-select"
                        style={{ width: 'auto', minHeight: '44px', padding: '2px 4px' }}
                      >
                        {WEEKDAYS.map(w => <option key={w} value={w}>{w}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => setAuditRoutineList(auditRoutineList.filter((_, i) => i !== sIdx))}
                        className="cm-btn-danger-icon"
                        title="Delete Slot"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%' }}>
                      <input
                        type="time"
                        value={slot.startTime}
                        onChange={(e) => {
                          const updated = [...auditRoutineList];
                          updated[sIdx].startTime = e.target.value;
                          setAuditRoutineList(updated);
                        }}
                        className="cm-routine-time-input"
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>to</span>
                      <input
                        type="time"
                        value={slot.endTime}
                        onChange={(e) => {
                          const updated = [...auditRoutineList];
                          updated[sIdx].endTime = e.target.value;
                          setAuditRoutineList(updated);
                        }}
                        className="cm-routine-time-input"
                        style={{ flex: 1 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mandatory Reason */}
            <div>
              <label className="cm-label">
                Reason for Routine Modification (Required for Audit Trail) *
              </label>
              <input
                type="text"
                value={auditReason}
                onChange={(e) => setAuditReason(e.target.value)}
                placeholder="e.g. Rescheduled Saturday class to 7:00 PM due to holiday"
                className="cm-input"
              />
            </div>

            {/* Audit History Log */}
            {auditHistory.length > 0 && (
              <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1rem' }}>
                <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  Previous Routine Changes
                </h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '140px', overflowY: 'auto' }}>
                  {auditHistory.map((ah) => (
                    <div
                      key={ah.id}
                      className="cm-routine-audit-item"
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', flexWrap: 'wrap', gap: '0.2rem' }}>
                        <span>Phase: {ah.phase_id} • By: {ah.changer_name || ah.changed_by_name || `Admin ${ah.changed_by}`}</span>
                        <span>{ah.changed_at}</span>
                      </div>
                      <div style={{ marginTop: '0.2rem', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                        Reason: {ah.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="cm-modal-actions">
              <button
                onClick={() => setAuditModalDef(null)}
                className="cm-btn cm-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRoutineChange}
                disabled={auditLoading || !auditReason.trim()}
                className="cm-btn cm-btn-primary"
              >
                Save Routine & Record Audit
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── MODAL: DISCARD DRAFT CONFIRMATION ── */}
      {showDiscardModal && typeof document !== 'undefined' && createPortal(
        <div className="cm-modal-overlay">
          <div className="cm-modal-dialog" style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div className="cm-modal-danger-icon">
                <AlertCircle size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Discard Course Draft?
                </h3>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Are you sure you want to discard your unsaved draft changes? Any modifications you made will be permanently removed from your browser session.
            </p>

            <div className="cm-modal-actions" style={{ justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowDiscardModal(false)}
                className="cm-btn cm-btn-secondary"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={handleDiscardDraft}
                className="cm-btn cm-btn-primary cm-btn-confirm-discard"
              >
                Discard Draft
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showBatchModal && (
        <BatchFormModal
          mode="create"
          isOpen={showBatchModal}
          initialCourseDef={createBatchTargetCourse}
          onClose={() => {
            setShowBatchModal(false);
            setCreateBatchTargetCourse(null);
          }}
          onSuccess={() => {
            setShowBatchModal(false);
            setCreateBatchTargetCourse(null);
            showToast('Batch created successfully!');
            fetchCourses();
          }}
        />
      )}
    </div>
  );
}
