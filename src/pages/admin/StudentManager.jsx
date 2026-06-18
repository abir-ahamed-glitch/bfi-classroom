import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Search, Copy, CheckCircle2, User, UserCheck, CheckSquare, Square, Edit, X, FileSpreadsheet, Trash2, GraduationCap, Clapperboard, Lock } from 'lucide-react';
import BulkStudentImport from '../../components/admin/BulkStudentImport';
import { getOrdinalSuffix } from '../../utils/formatUtils';

// Helper function to dynamically sync installments and payment status based on fees
const syncInstallmentsAndStatus = (target) => {
  if (!target) return;
  const fullFeeNum = parseFloat((target.full_fee || '').replace(/[^\d.]/g, '')) || 0;
  const amountPaidNum = parseFloat((target.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
  const discountNum = parseFloat((target.discount || '').replace(/[^\d.]/g, '')) || 0;
  const remainingDue = Math.max(0, fullFeeNum - discountNum - amountPaidNum);

  // 1. Auto-detect payment status
  if (fullFeeNum > 0) {
    if (amountPaidNum + discountNum >= fullFeeNum) {
      target.status = 'Paid Full';
    } else {
      if (target.status === 'Paid Full') {
        if (amountPaidNum > 0 || discountNum > 0) {
          target.status = 'Partial';
        } else {
          target.status = 'Due';
        }
      } else if (!target.status) {
        if (amountPaidNum > 0 || discountNum > 0) {
          target.status = 'Partial';
        } else {
          target.status = 'Due';
        }
      }
    }
  }

  // 2. Auto-adjust installments
  if (remainingDue <= 0) {
    target.installments = [];
  } else {
    const currentInst = target.installments || [];
    if (currentInst.length === 0) {
      target.installments = [{ amount: String(remainingDue), dueDate: '', status: 'Pending' }];
    } else {
      const updatedInst = [];
      let runningSum = 0;
      for (let i = 0; i < currentInst.length; i++) {
        const inst = currentInst[i];
        const amountVal = parseFloat((inst.amount || '').replace(/[^\d.]/g, '')) || 0;
        
        if (runningSum >= remainingDue) {
          break;
        }
        
        if (runningSum + amountVal >= remainingDue) {
          const leftover = remainingDue - runningSum;
          updatedInst.push({
            ...inst,
            amount: String(leftover)
          });
          runningSum = remainingDue;
          break;
        } else {
          updatedInst.push({
            ...inst,
            amount: String(amountVal)
          });
          runningSum += amountVal;
        }
      }
      
      if (runningSum < remainingDue) {
        const leftover = remainingDue - runningSum;
        updatedInst.push({
          amount: String(leftover),
          dueDate: '',
          status: 'Pending'
        });
      }
      target.installments = updatedInst;
    }
  }
};

const hasPendingDueOrPartialPayment = (course) => {
  if (!course || !course.fee_details) return false;
  
  let feeDetails = {};
  try {
    feeDetails = typeof course.fee_details === 'string' 
      ? JSON.parse(course.fee_details) 
      : course.fee_details;
  } catch (e) {
    console.error('Error parsing course fee details:', e);
    return false;
  }

  if (!feeDetails) return false;
  
  const isUnpaid = (phase) => {
    if (!phase) return false;
    
    // If installments exist, they are the source of truth
    if (phase.installments && phase.installments.length > 0) {
      return phase.installments.some(inst => inst.status === 'Pending' || inst.status === 'Due');
    }

    // Status checks (when no installments)
    const status = phase.status;
    if (status === 'Paid Full' || status === 'Waived') {
      return false;
    }
    if (status === 'Partial' || status === 'Pending' || status === 'Due') {
      return true;
    }
    
    // Fallback numerical check
    const fullFee = parseFloat((phase.full_fee || '').toString().replace(/[^\d.]/g, '')) || 0;
    if (fullFee === 0) return false;
    
    const amountPaid = parseFloat((phase.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
    const discount = parseFloat((phase.discount || '').toString().replace(/[^\d.]/g, '')) || 0;
    const remainingDue = Math.max(0, fullFee - discount - amountPaid);
    
    return remainingDue > 0;
  };

  if (course.course_type === 'filmmaking') {
    return isUnpaid(feeDetails.phase1) || isUnpaid(feeDetails.phase2);
  } else {
    return isUnpaid(feeDetails);
  }
};

// Helper subcomponent for rendering fee fields and installment details
function FeeRow({ 
  courseName, 
  label, 
  phaseKey, 
  feeData, 
  onChange, 
  onDiscountBlur, 
  onRemoveInstallment, 
  onInstallmentChange,
  disabled = false
}) {
  const key = phaseKey ? `${phaseKey}.` : '';
  const courseFees = feeData?.[courseName] || {};
  const data = phaseKey ? (courseFees[phaseKey] || {}) : courseFees;

  const fullFeeNum = parseFloat((data.full_fee || '').replace(/[^\d.]/g, '')) || 0;
  const amountPaidNum = parseFloat((data.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
  const discountNum = parseFloat((data.discount || '').replace(/[^\d.]/g, '')) || 0;
  const remainingDue = Math.max(0, fullFeeNum - discountNum - amountPaidNum);
  
  const hasError = amountPaidNum > fullFeeNum;
  const hasSumError = (amountPaidNum + discountNum) > fullFeeNum;

  const isFullySatisfied = fullFeeNum > 0 && amountPaidNum + discountNum >= fullFeeNum;
  const allInstallmentsPaid = remainingDue > 0 && 
    (data.installments || []).length > 0 && 
    (data.installments || []).every(inst => inst.status === 'Paid');
  const isFullyCompleted = isFullySatisfied || allInstallmentsPaid;

  let completionMessage = '';
  if (label) {
    if (label.toLowerCase().includes('phase 1')) {
      completionMessage = '1st Phase fee completed';
    } else if (label.toLowerCase().includes('phase 2')) {
      completionMessage = '2nd Phase fee completed';
    } else {
      completionMessage = `${label} fee completed`;
    }
  } else {
    completionMessage = `${courseName} fee completed`;
  }

  return (
    <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', opacity: disabled ? 0.85 : 1 }}>
      {disabled && (
        <div style={{
          fontSize: '0.75rem',
          color: '#fbbf24',
          background: 'rgba(245, 158, 11, 0.05)',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          padding: '0.4rem 0.6rem',
          borderRadius: '6px',
          marginBottom: '0.6rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          fontWeight: '500'
        }}>
          <span>⚠️</span> Locked until "Phase 1: Passed Exam" is checked
        </div>
      )}
      {(label || (fullFeeNum > 0 && amountPaidNum + discountNum >= fullFeeNum)) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          {label ? (
            <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {disabled && <span>🔒</span>} {label}
            </p>
          ) : <div />}
          {fullFeeNum > 0 && amountPaidNum + discountNum >= fullFeeNum && (
            <span style={{ 
              fontSize: '0.72rem', 
              fontWeight: '600', 
              color: '#34d399', 
              background: 'rgba(52, 211, 153, 0.1)', 
              padding: '0.15rem 0.45rem', 
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              border: '1px solid rgba(52, 211, 153, 0.2)'
            }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#34d399' }}></span>
              Paid
            </span>
          )}
        </div>
      )}
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Course Fee</label>
          <input
            type="text"
            value={data.full_fee || ''}
            disabled={disabled}
            onChange={e => onChange(courseName, `${key}full_fee`, e.target.value)}
            className="input-glass"
            placeholder="e.g. 15,000"
            style={{ 
              paddingLeft: '0.65rem', 
              fontSize: '0.83rem',
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? 'not-allowed' : 'text'
            }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Amount Paid</label>
          <input
            type="text"
            value={data.amount_paid || ''}
            disabled={disabled}
            onChange={e => onChange(courseName, `${key}amount_paid`, e.target.value)}
            className="input-glass"
            placeholder="e.g. 10,000"
            style={{ 
              paddingLeft: '0.65rem', 
              fontSize: '0.83rem',
              borderColor: (hasError || hasSumError) ? '#ef4444' : 'rgba(255,255,255,0.1)',
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? 'not-allowed' : 'text'
            }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.25rem', color: '#10b981', fontSize: '0.78rem', fontWeight: 600 }}>🏷️ Discount</label>
          <input
            type="text"
            value={data.discount || ''}
            disabled={disabled}
            onChange={e => onChange(courseName, `${key}discount`, e.target.value)}
            onBlur={e => onDiscountBlur(courseName, phaseKey, e.target.value)}
            className="input-glass"
            placeholder="e.g. 2,000 or 10%"
            style={{ 
              paddingLeft: '0.65rem', 
              fontSize: '0.83rem',
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? 'not-allowed' : 'text'
            }}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Payment Status</label>
          <select
            value={data.status || ''}
            disabled={disabled}
            onChange={e => onChange(courseName, `${key}status`, e.target.value)}
            className="input-glass"
            style={{ 
              paddingTop: '0.2rem', 
              paddingBottom: '0.2rem', 
              paddingLeft: '0.65rem', 
              paddingRight: '1.75rem', 
              fontSize: '0.83rem', 
              height: '38px',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba(255,255,255,0.6)'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
              backgroundPosition: 'right 0.5rem center',
              backgroundSize: '1rem',
              backgroundRepeat: 'no-repeat',
              appearance: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              color: data.status ? (
                data.status === 'Paid Full' ? '#34d399' :
                data.status === 'Partial' ? '#fbbf24' :
                data.status === 'Pending' ? '#60a5fa' :
                data.status === 'Waived' ? '#c084fc' : '#f87171'
              ) : 'var(--text-secondary)',
              borderColor: data.status ? (
                data.status === 'Paid Full' ? 'rgba(52, 211, 153, 0.3)' :
                data.status === 'Partial' ? 'rgba(251, 191, 36, 0.3)' :
                data.status === 'Pending' ? 'rgba(96, 165, 250, 0.3)' :
                data.status === 'Waived' ? 'rgba(192, 132, 252, 0.3)' : 'rgba(248, 113, 113, 0.3)'
              ) : 'rgba(255,255,255,0.1)',
              fontWeight: data.status ? '600' : 'normal'
            }}
          >
            <option value="" style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary, #030b19)' }}>— Select —</option>
            <option value="Paid Full" style={{ color: '#34d399', background: 'var(--bg-secondary, #030b19)' }}>✅ Paid Full</option>
            <option value="Partial" style={{ color: '#fbbf24', background: 'var(--bg-secondary, #030b19)' }}>⚠️ Partial Payment</option>
            <option value="Pending" style={{ color: '#60a5fa', background: 'var(--bg-secondary, #030b19)' }}>🕐 Pending</option>
            <option value="Waived" style={{ color: '#c084fc', background: 'var(--bg-secondary, #030b19)' }}>🎁 Waived / Free</option>
            <option value="Due" style={{ color: '#f87171', background: 'var(--bg-secondary, #030b19)' }}>❌ Due / Unpaid</option>
          </select>
        </div>
      </div>

      {(hasError || hasSumError) && (
        <p style={{ color: '#ef4444', fontSize: '0.75rem', margin: '0.25rem 0 0.5rem 0' }}>
          {hasError 
            ? '⚠️ Amount paid cannot exceed the course fee.' 
            : '⚠️ Amount paid + discount cannot exceed the course fee.'}
        </p>
      )}

      {/* Installment Section: only shows if remainingDue > 0 */}
      {remainingDue > 0 && (
        <div style={{ 
          marginTop: '0.75rem', 
          padding: '0.75rem', 
          background: 'rgba(245, 158, 11, 0.02)', 
          borderRadius: '8px', 
          border: '1px dashed rgba(245, 158, 11, 0.3)' 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <span style={{ fontSize: '0.78rem', color: '#fbbf24', fontWeight: 600 }}>
              📅 Installment Details (Due: {remainingDue.toLocaleString()} BDT)
            </span>
          </div>
          
          {(data.installments || []).length === 0 ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
              No installment details specified.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {(data.installments || []).map((inst, instIdx) => {
                const instStatusColor = inst.status === 'Paid' ? '#34d399' : '#fbbf24';
                return (
                  <div 
                    key={instIdx} 
                    style={{ 
                      display: 'flex', 
                      flexDirection: 'column',
                      gap: '0.5rem', 
                      padding: '0.6rem', 
                      background: 'rgba(255, 255, 255, 0.02)', 
                      borderRadius: '8px', 
                      border: '1px solid rgba(255, 255, 255, 0.06)' 
                    }}
                  >
                    {/* Top Row: Installment # Label, Amount input, and Remove Button */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        Installment #{instIdx + 1}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, justifyContent: 'flex-end' }}>
                        <div style={{ position: 'relative', width: '130px' }}>
                          <span style={{ position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>BDT</span>
                          <input
                            type="text"
                            value={inst.amount || ''}
                            disabled={disabled}
                            onChange={e => onInstallmentChange(courseName, phaseKey, instIdx, 'amount', e.target.value)}
                            placeholder="Amount"
                            className="input-glass"
                            style={{ 
                              fontSize: '0.78rem', 
                              paddingLeft: '2.2rem', 
                              paddingRight: '0.5rem', 
                              height: '28px', 
                              paddingTop: 0, 
                              paddingBottom: 0, 
                              textAlign: 'right',
                              opacity: disabled ? 0.5 : 1,
                              cursor: disabled ? 'not-allowed' : 'text'
                            }}
                          />
                        </div>
                        <button 
                          type="button" 
                          disabled={disabled}
                          onClick={() => onRemoveInstallment(courseName, phaseKey, instIdx)} 
                          style={{ 
                            background: disabled ? 'rgba(255,255,255,0.05)' : 'rgba(239, 68, 68, 0.1)', 
                            border: 'none', 
                            color: disabled ? 'var(--text-muted)' : '#f87171', 
                            cursor: disabled ? 'not-allowed' : 'pointer', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            borderRadius: '4px',
                            width: '24px',
                            height: '24px',
                            padding: 0,
                            opacity: disabled ? 0.5 : 1
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Bottom Row: Due Date and Status Dropdown */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Due Date</label>
                        <input
                          type="date"
                          value={inst.dueDate || ''}
                          disabled={disabled}
                          onChange={e => onInstallmentChange(courseName, phaseKey, instIdx, 'dueDate', e.target.value)}
                          className="input-glass"
                          min={instIdx > 0 ? (data.installments[instIdx - 1].dueDate || '') : ''}
                          style={{ 
                            fontSize: '0.78rem', 
                            padding: '0.25rem 0.5rem', 
                            height: '28px',
                            opacity: disabled ? 0.5 : 1,
                            cursor: disabled ? 'not-allowed' : 'text'
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Status</label>
                        <select
                          value={inst.status || 'Pending'}
                          disabled={disabled}
                          onChange={e => onInstallmentChange(courseName, phaseKey, instIdx, 'status', e.target.value)}
                          className="input-glass"
                          style={{ 
                            fontSize: '0.78rem', 
                            paddingTop: '0.1rem',
                            paddingBottom: '0.1rem',
                            paddingLeft: '0.5rem', 
                            paddingRight: '1.5rem', 
                            height: '28px', 
                            appearance: 'none',
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba(255,255,255,0.6)'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                            backgroundPosition: 'right 0.35rem center',
                            backgroundSize: '0.8rem',
                            backgroundRepeat: 'no-repeat',
                            color: instStatusColor,
                            borderColor: disabled ? 'rgba(255,255,255,0.1)' : `${instStatusColor}4D`,
                            fontWeight: '600',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.5 : 1
                          }}
                        >
                          <option value="Pending" style={{ color: '#fbbf24', background: 'var(--bg-secondary, #030b19)' }}>Pending</option>
                          <option value="Paid" style={{ color: '#34d399', background: 'var(--bg-secondary, #030b19)' }}>Paid</option>
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Fully Completed Banner */}
      {isFullyCompleted && (
        <div style={{
          marginTop: '0.75rem',
          padding: '0.6rem 0.75rem',
          background: 'rgba(16, 185, 129, 0.06)',
          border: '1px solid rgba(16, 185, 129, 0.2)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          color: '#34d399',
          fontSize: '0.78rem',
          fontWeight: '600'
        }}>
          <span style={{ 
            display: 'inline-block', 
            width: '6px', 
            height: '6px', 
            borderRadius: '50%', 
            background: '#34d399', 
            boxShadow: '0 0 8px #34d399' 
          }}></span>
          {completionMessage}
        </div>
      )}
    </div>
  );
}

export default function StudentManager() {
  const [students, setStudents] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Edit Modal State
  const [editingStudent, setEditingStudent] = useState(null);
  const [editFormData, setEditFormData] = useState({
    firstName: '', lastName: '', email: '', username: '', batchNumber: '', mobileNumber: '',
    phase1_fee: '', phase2_fee: '',
    course_fees: {},   // { [courseName]: { amount: '', status: '' } }
    discount: '',      // discount note / amount
    courses: []
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState('');

  // Academic Records Modal State
  const [academicStudent, setAcademicStudent] = useState(null);
  const [academicCourseId, setAcademicCourseId] = useState(null);
  const [academicFormData, setAcademicFormData] = useState({
    attendance_classes: '',
    attendance_total: '',
    exam_written: '',
    assignment_screenplay: '',
    assignment_shooting_script: ''
  });
  const [isAcademicSaving, setIsAcademicSaving] = useState(false);
  const [academicError, setAcademicError] = useState('');

  // Phase 2 Completion Modal State
  const [phase2Student, setPhase2Student] = useState(null);
  const [phase2CourseId, setPhase2CourseId] = useState(null);
  const [phase2FormData, setPhase2FormData] = useState({
    phase2_shooting_attended: false,
    phase2_editing_attended: false
  });
  const [isPhase2Saving, setIsPhase2Saving] = useState(false);
  const [phase2Error, setPhase2Error] = useState('');

  // Confirmation Modal State
  const [confirmConfig, setConfirmConfig] = useState(null);

  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    mobileNumber: '',
    batchNumber: '',
    snNo: '',
    year: new Date().getFullYear().toString(),
    manualUsername: '',
    manualPassword: '',
    courses: ['Online Filmmaking Course'] // Default
  });

  const availableCourses = [
    { name: 'Online Filmmaking Course', type: 'filmmaking' },
    { name: 'Film Appreciation Course', type: 'workshop' },
    { name: 'Script Writing', type: 'workshop' },
    { name: 'Cinematography', type: 'workshop' },
    { name: 'Acting', type: 'workshop' }
  ];

  const fetchStudents = async () => {
    if (window.location.hostname.includes('github.io')) {
      setStudents([
        { 
          id: 1, 
          student_id: 'BFI01-2024', 
          full_name: 'John Doe', 
          first_name: 'John',
          last_name: 'Doe',
          username: 'johndoe', 
          email: 'john@example.com', 
          batch_number: '75',
          created_at: new Date().toISOString(),
          enrollments: [
            { id: 1, course_name: 'Online Filmmaking Course', course_type: 'filmmaking', step1_completed: 1, step2_completed: 1, step3_completed: 1, step4_completed: 0 }
          ]
        },
        { 
          id: 2, 
          student_id: 'BFI02-2024', 
          full_name: 'Jane Smith', 
          first_name: 'Jane',
          last_name: 'Smith',
          username: 'janesmith', 
          email: 'jane@example.com', 
          batch_number: '75',
          created_at: new Date().toISOString(),
          enrollments: [
            { id: 2, course_name: 'Film Appreciation Course', course_type: 'workshop', step1_completed: 1, step4_completed: 1 }
          ]
        }
      ]);
      return;
    }

    try {
      const res = await fetch(`/api/admin/students?t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students);
      }
    } catch (err) {
      console.error('Failed to fetch students', err);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  // Prevent background scrolling when modal is open
  useEffect(() => {
    if (editingStudent || confirmConfig || academicStudent || phase2Student) {
      document.body.classList.add('modal-open');
      document.documentElement.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
      document.documentElement.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
      document.documentElement.classList.remove('modal-open');
    };
  }, [editingStudent, confirmConfig, academicStudent, phase2Student]);

  const toggleProgress = async (studentId, enrollmentId, stepField, currentValue, courseName) => {
    if (courseName === 'Online Filmmaking Course') {
      const student = students.find(s => s.id === studentId);
      const e = student?.enrollments?.find(env => env.id === enrollmentId);
      const willBeChecked = !currentValue;

      let feeDetails = {};
      if (e?.fee_details) {
        try {
          feeDetails = typeof e.fee_details === 'string' ? JSON.parse(e.fee_details) : e.fee_details;
        } catch (err) {
          console.error(err);
        }
      }
      const phase1 = feeDetails?.phase1 || {};
      const fullFeeNum = parseFloat((phase1.full_fee || '').replace(/[^\d.]/g, '')) || 0;
      const amountPaidNum = parseFloat((phase1.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
      const discountNum = parseFloat((phase1.discount || '').replace(/[^\d.]/g, '')) || 0;
      const remainingDue = Math.max(0, fullFeeNum - discountNum - amountPaidNum);
      
      const phase1PaidAny = amountPaidNum > 0 || (phase1.installments || []).some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').replace(/[^\d.]/g, '')) > 0);
      const phase1FullyPaid = (fullFeeNum > 0 && amountPaidNum + discountNum >= fullFeeNum) ||
        (fullFeeNum > 0 && remainingDue > 0 && (phase1.installments || []).length > 0 && (phase1.installments || []).every(inst => inst.status === 'Paid'));

      const phase2 = feeDetails?.phase2 || {};
      const phase2PaidAny = (parseFloat((phase2.amount_paid || '').replace(/[^\d.]/g, '')) || 0) > 0 ||
        (phase2.installments || []).some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').replace(/[^\d.]/g, '')) > 0);

      if (stepField === 'step2_completed') {
        openAcademicModal(student, enrollmentId);
        return;
      }

      // step4 for Online Filmmaking Course always opens the Phase 2 modal
      if (stepField === 'step4_completed') {
        if (!e?.step1_completed || !e?.step2_completed || !e?.step3_completed) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot update "Phase 2: Completed Course". All previous phases must be completed first.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        openPhase2Modal(student, enrollmentId);
        return;
      }

      if (willBeChecked) {
        if (stepField === 'step3_completed' && (!e?.step1_completed || !e?.step2_completed)) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot check "Phase 2: Admitted". "Phase 1: Admitted" and "Phase 1: Passed Exam" must be checked first.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (stepField === 'step3_completed' && !phase1FullyPaid) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot check "Phase 2: Admitted" because Phase 1 is not fully paid.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
      } else {
        if (stepField === 'step3_completed' && e?.step4_completed) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Phase 2: Admitted" while "Phase 2: Completed" is checked.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (stepField === 'step3_completed' && phase2PaidAny) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Phase 2: Admitted" because a payment has already been made for this phase.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (stepField === 'step1_completed' && (e?.step2_completed || e?.step3_completed || e?.step4_completed)) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Phase 1: Admitted" while subsequent phases are checked.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        if (stepField === 'step1_completed' && phase1PaidAny) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Phase 1: Admitted" because a payment has already been made for this phase.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
      }
    }

    if (courseName !== 'Online Filmmaking Course') {
      const student = students.find(s => s.id === studentId);
      const e = student?.enrollments?.find(env => env.id === enrollmentId);
      const willBeChecked = !currentValue;

      if (stepField === 'step4_completed') {
        if (!e?.step1_completed) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot update "Completed Course" because "Admission Confirmed" is not yet completed.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
        openAcademicModal(student, enrollmentId);
        return;
      }

      if (willBeChecked) {
        // Step 1 check has no other restrictions
      } else {
        if (stepField === 'step1_completed' && e?.step4_completed) {
          setConfirmConfig({ title: 'Action Restricted', message: 'Cannot uncheck "Admission Confirmed" while "Completed Course" is checked.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
          return;
        }
      }
    }

    try {
      const res = await fetch(`/api/admin/students/${studentId}/progress`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ 
          course_id: enrollmentId, 
          [stepField]: currentValue ? 0 : 1 
        })
      });
      if (res.ok) {
        fetchStudents();
      } else {
        const data = await res.json();
        setConfirmConfig({ title: 'Update Failed', message: data.error || 'Failed to update progress.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
      }
    } catch (err) {
      console.error('Progress update error', err);
    }
  };

  const confirmDeleteStudent = (studentId, studentName, batchNumber) => {
    const batchLabel = batchNumber ? `${getOrdinalSuffix(batchNumber)} Batch` : null;
    const messageNode = (
      <span>
        You are about to permanently remove the academic record and account for{' '}
        <strong style={{ fontWeight: 700, color: '#f43f5e' }}>{studentName}</strong>
        {batchLabel && (
          <span style={{ fontWeight: 400, color: '#8b5cf6' }}>{' '}({batchLabel})</span>
        )}
        {' '}from the institutional database. This action is irreversible and will delete all associated data.
      </span>
    );
    setConfirmConfig({
      title: 'Delete Student Account',
      message: messageNode,
      confirmText: 'Delete',
      type: 'danger',
      onConfirm: () => performDelete(studentId)
    });
  };

  const performDelete = async (studentId) => {
    try {
      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (res.ok) {
        fetchStudents();
      } else {
        const data = await res.json();
        setConfirmConfig({ title: 'Deletion Failed', message: data.error || 'Failed to delete student.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
      }
    } catch (err) {
      console.error('Delete student error', err);
      setConfirmConfig({ title: 'Error', message: 'An error occurred while deleting the student.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleCreateStudent = async (e) => {
    e.preventDefault();
    setIsDeploying(true);
    setErrorMsg('');
    setSuccessData(null);
    setCopied(false);

    try {
      const res = await fetch('/api/admin/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create student account');
      }

      setSuccessData(data.student);
      setFormData({
        firstName: '',
        lastName: '',
        email: '',
        mobileNumber: '',
        batchNumber: '',
        snNo: '',
        year: new Date().getFullYear().toString(),
        manualUsername: '',
        manualPassword: '',
        courses: ['Online Filmmaking Course']
      });
      fetchStudents();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsDeploying(false);
    }
  };

  const copyCredentials = () => {
    if (!successData) return;
    const text = `BFI Classroom Credentials\nName: ${successData.firstName} ${successData.lastName}\nStudent ID: ${successData.studentId}\nUsername: ${successData.username}\nPassword: ${successData.rawPassword}\nLink: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const openEditModal = (student) => {
    setEditError('');
    setEditingStudent(student);
    const names = student.full_name ? student.full_name.split(' ') : ['', ''];
    
    let extractedSn = '';
    let extractedYear = new Date().getFullYear().toString();
    if (student.student_id && student.student_id.startsWith('BFI')) {
      const idStr = student.student_id.substring(3);
      if (idStr.length === 8) {
        extractedSn = idStr.substring(0, 2);
        extractedYear = idStr.substring(4, 8);
      }
    }

    // Build course_fees with per-course structure:
    // Online Filmmaking Course → { phase1: {full_fee, amount_paid, status, discount, installments}, phase2: ... }
    // All other courses        → { full_fee, amount_paid, status, discount, installments }
    const builtFees = {};
    (student.enrollments || []).forEach(enr => {
      const cn = enr.course_name;
      let enrFeeDetails = {};
      if (enr.fee_details) {
        try {
          enrFeeDetails = typeof enr.fee_details === 'string' ? JSON.parse(enr.fee_details) : enr.fee_details;
        } catch (e) {
          console.error('Failed to parse fee_details', e);
        }
      }
      if (cn === 'Online Filmmaking Course') {
        builtFees[cn] = {
          phase1: {
            full_fee:    enrFeeDetails?.phase1?.full_fee    ?? '',
            amount_paid: enrFeeDetails?.phase1?.amount_paid ?? '',
            status:      enrFeeDetails?.phase1?.status      ?? '',
            discount:    enrFeeDetails?.phase1?.discount    ?? '',
            installments: enrFeeDetails?.phase1?.installments || []
          },
          phase2: {
            full_fee:    enrFeeDetails?.phase2?.full_fee    ?? '',
            amount_paid: enrFeeDetails?.phase2?.amount_paid ?? '',
            status:      enrFeeDetails?.phase2?.status      ?? '',
            discount:    enrFeeDetails?.phase2?.discount    ?? '',
            installments: enrFeeDetails?.phase2?.installments || []
          }
        };
        syncInstallmentsAndStatus(builtFees[cn].phase1);
        syncInstallmentsAndStatus(builtFees[cn].phase2);
      } else {
        builtFees[cn] = {
          full_fee:    enrFeeDetails?.full_fee    ?? '',
          amount_paid: enrFeeDetails?.amount_paid ?? '',
          status:      enrFeeDetails?.status      ?? '',
          discount:    enrFeeDetails?.discount    ?? '',
          installments: enrFeeDetails?.installments || []
        };
        syncInstallmentsAndStatus(builtFees[cn]);
      }
    });

    setEditFormData({
      firstName: student.first_name || names[0] || '',
      lastName: student.last_name || names.slice(1).join(' ') || '',
      email: student.email || '',
      mobileNumber: student.mobile_number || '',
      username: student.username || '',
      batchNumber: student.batch_number || '',
      snNo: extractedSn,
      year: extractedYear,
      phase1_fee: student.phase1_fee || '',
      phase2_fee: student.phase2_fee || '',
      course_fees: builtFees,
      discount: student.discount || '',
      courses: student.enrollments ? student.enrollments.map(e => e.course_name) : []
    });
  };

  const handleCourseChange = (courseName) => {
    const currentCourses = formData.courses;
    if (currentCourses.includes(courseName)) {
      setFormData({ ...formData, courses: currentCourses.filter(c => c !== courseName) });
    } else {
      setFormData({ ...formData, courses: [...currentCourses, courseName] });
    }
  };

  const handleEditCourseChange = (courseName) => {
    const currentCourses = editFormData.courses || [];
    const isRemoving = currentCourses.includes(courseName);
    const newCourses = isRemoving
      ? currentCourses.filter(c => c !== courseName)
      : [...currentCourses, courseName];

    const newFees = { ...editFormData.course_fees };
    if (!isRemoving && !newFees[courseName]) {
      if (courseName === 'Online Filmmaking Course') {
        newFees[courseName] = {
          phase1: { full_fee: '', amount_paid: '', status: '', discount: '', installments: [] },
          phase2: { full_fee: '', amount_paid: '', status: '', discount: '', installments: [] }
        };
        syncInstallmentsAndStatus(newFees[courseName].phase1);
        syncInstallmentsAndStatus(newFees[courseName].phase2);
      } else {
        newFees[courseName] = { full_fee: '', amount_paid: '', status: '', discount: '', installments: [] };
        syncInstallmentsAndStatus(newFees[courseName]);
      }
    } else if (isRemoving) {
      delete newFees[courseName];
    }

    setEditFormData({ ...editFormData, courses: newCourses, course_fees: newFees });
  };

  const handleCourseFeeChange = (courseName, field, value) => {
    setEditFormData(prev => {
      const fees = { ...prev.course_fees };
      if (field.includes('.')) {
        const [phase, key] = field.split('.');
        fees[courseName] = {
          ...fees[courseName],
          [phase]: { ...fees[courseName]?.[phase], [key]: value }
        };
        syncInstallmentsAndStatus(fees[courseName][phase]);
      } else {
        fees[courseName] = { ...fees[courseName], [field]: value };
        syncInstallmentsAndStatus(fees[courseName]);
      }
      return { ...prev, course_fees: fees };
    });
  };

  const handleDiscountBlur = (courseName, phaseKey, discountValue) => {
    if (!discountValue) return;
    const match = discountValue.trim().match(/^(\d+(?:\.\d+)?)\s*%/);
    if (match) {
      const percent = parseFloat(match[1]);
      const feeData = editFormData.course_fees?.[courseName] || {};
      const feeStr = phaseKey ? feeData[phaseKey]?.full_fee : feeData.full_fee;
      const feeNum = parseFloat((feeStr || '').replace(/[^\d.]/g, ''));
      if (!isNaN(feeNum)) {
        const calculated = Math.round((feeNum * percent) / 100);
        const field = phaseKey ? `${phaseKey}.discount` : 'discount';
        handleCourseFeeChange(courseName, field, String(calculated));
      }
    }
  };

  const handleRemoveInstallment = (courseName, phaseKey, index) => {
    setEditFormData(prev => {
      const fees = { ...prev.course_fees };
      const target = phaseKey ? fees[courseName]?.[phaseKey] : fees[courseName];
      if (target) {
        const currentInst = target.installments || [];
        const updatedInst = currentInst.filter((_, idx) => idx !== index);
        target.installments = updatedInst;
        syncInstallmentsAndStatus(target);
      }
      return { ...prev, course_fees: fees };
    });
  };

  const handleInstallmentChange = (courseName, phaseKey, index, key, value) => {
    setEditFormData(prev => {
      const fees = { ...prev.course_fees };
      const target = phaseKey ? fees[courseName]?.[phaseKey] : fees[courseName];
      if (target) {
        const currentInst = target.installments || [];
        const updatedInst = currentInst.map((inst, idx) => {
          if (idx === index) {
            return { ...inst, [key]: value };
          }
          return inst;
        });
        target.installments = updatedInst;
        syncInstallmentsAndStatus(target);
      }
      return { ...prev, course_fees: fees };
    });
  };

  const handleEditChange = (e) => setEditFormData({ ...editFormData, [e.target.name]: e.target.value });

  const openAcademicModal = (student, courseId) => {
    setAcademicError('');
    const enrollment = student.enrollments.find(e => e.id === courseId);
    setAcademicStudent({ ...student, enrollment });
    setAcademicCourseId(courseId);
    
    if (enrollment.course_name !== 'Online Filmmaking Course') {
      setAcademicFormData({
        attendance_classes: '0',
        attendance_total: '0',
        exam_written: enrollment.exam_written?.toString() || '0',
        assignment_screenplay: '0',
        assignment_shooting_script: '0'
      });
    } else {
      setAcademicFormData({
        attendance_classes: enrollment.attendance_classes?.toString() || '0',
        attendance_total: enrollment.attendance_total?.toString() || '22',
        exam_written: enrollment.exam_written?.toString() || '0',
        assignment_screenplay: enrollment.assignment_screenplay?.toString() || '0',
        assignment_shooting_script: enrollment.assignment_shooting_script?.toString() || '0'
      });
    }
  };

  const closeAcademicModal = () => {
    setAcademicStudent(null);
    setAcademicCourseId(null);
  };

  // ---- Phase 2 Modal handlers ----
  const openPhase2Modal = (student, courseId) => {
    setPhase2Error('');
    const enrollment = student.enrollments.find(e => e.id === courseId);
    if (!enrollment?.step1_completed || !enrollment?.step2_completed || !enrollment?.step3_completed) {
      setConfirmConfig({ title: 'Action Restricted', message: 'Cannot update "Phase 2: Completed Course". All previous phases must be completed first.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
      return;
    }
    setPhase2Student({ ...student, enrollment });
    setPhase2CourseId(courseId);
    setPhase2FormData({
      phase2_shooting_attended: !!(enrollment?.phase2_shooting_attended),
      phase2_editing_attended: !!(enrollment?.phase2_editing_attended)
    });
  };

  const closePhase2Modal = () => {
    setPhase2Student(null);
    setPhase2CourseId(null);
  };

  const submitPhase2 = async (e) => {
    e.preventDefault();
    setIsPhase2Saving(true);
    setPhase2Error('');

    try {
      const res = await fetch(`/api/admin/students/${phase2Student.id}/phase2-attendance/${phase2CourseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(phase2FormData)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update Phase 2 attendance');
      await fetchStudents();
      closePhase2Modal();
    } catch (err) {
      setPhase2Error(err.message);
    } finally {
      setIsPhase2Saving(false);
    }
  };

  const handleAcademicChange = (e) => {
    setAcademicFormData({ ...academicFormData, [e.target.name]: e.target.value });
  };

  const submitAcademic = async (e) => {
    e.preventDefault();
    setIsAcademicSaving(true);
    setAcademicError('');

    try {
      const res = await fetch(`/api/admin/students/${academicStudent.id}/academic-records/${academicCourseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(academicFormData)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update academic records');
      await fetchStudents();
      closeAcademicModal();
    } catch (err) {
      setAcademicError(err.message);
    } finally {
      setIsAcademicSaving(false);
    }
  };

  const validateFees = () => {
    for (const courseName of editFormData.courses || []) {
      const isOFC = courseName === 'Online Filmmaking Course';
      const feeData = editFormData.course_fees?.[courseName] || {};
      
      const checkRow = (data, label) => {
        const fullFee = parseFloat((data.full_fee || '').replace(/[^\d.]/g, '')) || 0;
        const amountPaid = parseFloat((data.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
        const discount = parseFloat((data.discount || '').replace(/[^\d.]/g, '')) || 0;
        
        if (amountPaid > fullFee) {
          return `${label}: Amount Paid (${amountPaid.toLocaleString()} BDT) cannot exceed the Course Fee (${fullFee.toLocaleString()} BDT).`;
        }
        if (amountPaid + discount > fullFee) {
          return `${label}: Amount Paid + Discount cannot exceed the Course Fee.`;
        }

        // Validate that installments are chronological
        const installments = data.installments || [];
        for (let i = 1; i < installments.length; i++) {
          const prevDate = installments[i - 1].dueDate;
          const currDate = installments[i].dueDate;
          if (prevDate && currDate && currDate < prevDate) {
            return `${label}: Installment #${i + 1} due date (${currDate}) cannot be earlier than Installment #${i} due date (${prevDate}).`;
          }
        }

        return null;
      };

      if (isOFC) {
        const err1 = checkRow(feeData.phase1 || {}, `${courseName} (Phase 1)`);
        if (err1) return err1;
        const err2 = checkRow(feeData.phase2 || {}, `${courseName} (Phase 2)`);
        if (err2) return err2;
      } else {
        const err = checkRow(feeData, courseName);
        if (err) return err;
      }
    }
    return null;
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    setEditError('');

    const valError = validateFees();
    if (valError) {
      setEditError(valError);
      return;
    }

    setIsEditing(true);

    try {
      const res = await fetch(`/api/admin/students/${editingStudent.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(editFormData)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update student profile');
      
      setEditingStudent(null);
      fetchStudents();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setIsEditing(false);
    }
  };

  const filteredStudents = students.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (s.full_name && s.full_name.toLowerCase().includes(q)) ||
      (s.student_id && s.student_id.toLowerCase().includes(q)) ||
      (s.email && s.email.toLowerCase().includes(q)) ||
      (s.mobile_number && s.mobile_number.includes(q)) ||
      (s.whatsapp_number && s.whatsapp_number.includes(q)) ||
      (s.batch_number && s.batch_number.toLowerCase().includes(q))
    );
  });

  return (
    <div className="page-container container">
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Student Accounts</h1>
        <p className="subtitle">Create and manage access for newly enrolled filmmakers.</p>
      </div>

      <div style={{ display: 'block' }}>
        {/* Bulk Import Panel */}
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileSpreadsheet className="text-accent" /> Bulk Import Students
            </h2>
            <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Upload an Excel or CSV file to quickly create multiple student accounts at once.</p>
          </div>
          <BulkStudentImport onImportComplete={fetchStudents} />
        </div>

        {/* Creator Panel */}
        <div className="glass-panel" style={{ padding: '2rem', marginBottom: '3rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserPlus className="text-accent" /> Register New Student (Manual)
            </h2>
          </div>
          
          <form onSubmit={handleCreateStudent} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>First Name</label>
                <input type="text" name="firstName" value={formData.firstName} onChange={handleChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Last Name</label>
                <input type="text" name="lastName" value={formData.lastName} onChange={handleChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Email</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} className="input-glass" required style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Mobile Number</label>
                <input type="text" name="mobileNumber" value={formData.mobileNumber} onChange={handleChange} className="input-glass" placeholder="+880..." style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Batch</label>
                <input type="text" name="batchNumber" value={formData.batchNumber} onChange={handleChange} className="input-glass" required placeholder="e.g. 75" style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>SN No.</label>
                <input type="text" name="snNo" value={formData.snNo} onChange={handleChange} className="input-glass" required placeholder="e.g. 01" style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Year</label>
                <input type="text" name="year" value={formData.year} onChange={handleChange} className="input-glass" required placeholder="e.g. 2024" style={{ width: '100%', paddingLeft: '1rem' }} />
              </div>
            </div>

            <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Select Enrolled Courses</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                {availableCourses.map(course => (
                  <label key={course.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', background: formData.courses.includes(course.name) ? 'rgba(56, 189, 248, 0.1)' : 'transparent', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid', borderColor: formData.courses.includes(course.name) ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)', transition: 'all 0.2s' }}>
                    <input 
                      type="checkbox" 
                      checked={formData.courses.includes(course.name)} 
                      onChange={() => handleCourseChange(course.name)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    <span style={{ fontSize: '0.9rem' }}>{course.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Optional: Manual Credentials</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>If left blank, secure credentials will be generated automatically.</p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <input type="text" name="manualUsername" value={formData.manualUsername} onChange={handleChange} className="input-glass" placeholder="Custom Username" style={{ width: '100%', paddingLeft: '1rem' }} />
                </div>
                <div>
                  <input type="text" name="manualPassword" value={formData.manualPassword} onChange={handleChange} className="input-glass" placeholder="Custom Password" style={{ width: '100%', paddingLeft: '1rem' }} />
                </div>
              </div>
            </div>

            {errorMsg && <div className="error-alert">{errorMsg}</div>}

            <button type="submit" className="btn btn-primary" disabled={isDeploying}>
              {isDeploying ? 'Creating Account...' : 'Create Student Account'}
            </button>
          </form>

          {/* Success Summary */}
          {successData && (
            <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(16, 185, 129, 0.12)', border: '2px solid rgba(16, 185, 129, 0.5)', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ color: '#059669', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><CheckCircle2 size={20} /> Success! Credentials Ready</h3>
                <button onClick={copyCredentials} className="btn" style={{ padding: '0.5rem 1rem', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px' }}>
                  {copied ? 'Copied!' : <><Copy size={16} /> Copy Details</>}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.95rem' }}>
                <p style={{ color: 'var(--text-primary)', margin: 0 }}><strong style={{ color: 'var(--text-secondary)' }}>Name:</strong> {successData.firstName} {successData.lastName}</p>
                <p style={{ color: 'var(--text-primary)', margin: 0 }}><strong style={{ color: 'var(--text-secondary)' }}>ID:</strong> {successData.studentId}</p>
                <p style={{ color: 'var(--text-primary)', margin: 0 }}><strong style={{ color: 'var(--text-secondary)' }}>Username:</strong>{' '}
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#2563eb', background: 'rgba(37,99,235,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{successData.username}</span>
                </p>
                <p style={{ color: 'var(--text-primary)', margin: 0 }}><strong style={{ color: 'var(--text-secondary)' }}>Password:</strong>{' '}
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#be185d', background: 'rgba(190,24,93,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{successData.rawPassword}</span>
                </p>
              </div>
              <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>* Note: Password is only displayed here once. Please copy and share it securely using the copy button above.</p>
            </div>
          )}
        </div>

        {/* Students List */}
        <div style={{ marginTop: '3rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
              <UserCheck className="text-secondary" /> Registered Students
            </h2>
            <div className="input-wrapper" style={{ width: '100%', maxWidth: '350px' }}>
              <Search className="input-icon" size={18} />
              <input 
                type="text" 
                placeholder="Search by name, ID, batch, email..." 
                className="input-glass" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="glass-panel student-manager-table-scroll" style={{ width: '100%', maxWidth: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', padding: '0', border: '1px solid var(--glass-border)', borderRadius: '12px', scrollbarGutter: 'stable both-edges' }}>
            <table className="student-manager-table" style={{ borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.02)', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th className="student-table-col-id" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Student ID</th>
                  <th className="student-table-col-name" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Name</th>
                  <th className="student-table-col-contact" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Username & Contact</th>
                  <th className="student-table-col-batch" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Batch</th>
                  <th className="student-table-col-progress" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Course Progression</th>
                  <th className="student-table-col-joined" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600' }}>Joined</th>
                  <th className="student-table-col-actions" style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--glass-border)', fontWeight: '600', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s, idx) => (
                  <tr 
                    key={s.id} 
                    className="animate-slide-up"
                    style={{ 
                      borderBottom: '1px solid var(--glass-border)', 
                      transition: 'background 0.2s',
                      animationDelay: `${idx * 0.05}s`
                    }} 
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(14, 165, 233, 0.03)'} 
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <td className="student-table-col-id" style={{ padding: '1.25rem 1.5rem', color: 'var(--text-secondary)', fontWeight: '500', fontSize: '0.85rem' }}>
                      {s.student_id}
                    </td>
                    <td className="student-table-col-name" style={{ padding: '1.25rem 1.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1rem', flexShrink: 0 }}>
                          {s.full_name.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{s.full_name}</span>
                      </div>
                    </td>
                    <td className="student-table-col-contact" style={{ padding: '1.25rem 1.5rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <span style={{ display: 'inline-block', background: 'rgba(56, 189, 248, 0.1)', color: 'var(--accent-primary)', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600', width: 'fit-content' }}>
                          @{s.username}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.email}</span>
                      </div>
                    </td>
                    <td className="student-table-col-batch" style={{ padding: '1.25rem 1.5rem' }}>
                      {s.batch_number ? (
                        <span className="badge-pill student-table-batch-pill" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', borderColor: 'rgba(139, 92, 246, 0.2)' }}>
                          {getOrdinalSuffix(s.batch_number)} Batch
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>N/A</span>
                      )}
                    </td>
                     <td className="student-table-col-progress" style={{ padding: '1.25rem 1.5rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {s.enrollments && s.enrollments.map(e => (
                          <div key={e.id} className="student-table-course-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(0,0,0,0.01)', padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)' }}>
                              {e.course_name}
                            </div>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                              {e.course_type === 'filmmaking' ? (
                                <>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step1_completed', e.step1_completed, e.course_name)} title="Phase 1: Admitted" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step1_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step1_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step2_completed', e.step2_completed, e.course_name)} title="Phase 1: Passed Exam" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step2_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step2_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                  <div style={{ width: '1px', height: '14px', background: 'var(--glass-border)', margin: '0 0.2rem' }}></div>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step3_completed', e.step3_completed, e.course_name)} title="Phase 2: Admitted" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step3_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step3_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step4_completed', e.step4_completed, e.course_name)} title="Phase 2: Completed Course" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step4_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step4_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step1_completed', e.step1_completed, e.course_name)} title="Admitted" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step1_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step1_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                  <button onClick={() => toggleProgress(s.id, e.id, 'step4_completed', e.step4_completed, e.course_name)} title="Completed Course" style={{ background: 'none', border: 'none', cursor: 'pointer', color: e.step4_completed ? '#10b981' : 'var(--text-muted)' }}>
                                    {e.step4_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                                  </button>
                                </>
                              )}
                              {e.step4_completed === 1 && hasPendingDueOrPartialPayment(e) && (
                                <Lock size={14} style={{ color: '#f87171', display: 'inline-block' }} title="Certificate Locked (Pending/Due/Partial Payment)" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="student-table-col-joined" style={{ padding: '1.25rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {new Date(s.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="student-table-col-actions" style={{ padding: '1.25rem 1.5rem', textAlign: 'center' }}>
                      <div className="student-table-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                        {s.enrollments && s.enrollments.length > 0 && (() => {
                          const e = s.enrollments[0];
                          const isAppreciation = e.course_name !== 'Online Filmmaking Course';
                          return (
                            <button 
                              onClick={() => openAcademicModal(s, e.id)}
                              className="btn" 
                              style={{ padding: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }} 
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} 
                              title={isAppreciation ? 'Exam Result' : 'Academic Records'}
                            >
                              <GraduationCap size={16} />
                            </button>
                          );
                        })()}
                        {s.enrollments && s.enrollments.find(e => e.course_name === 'Online Filmmaking Course') && (
                          <button
                            onClick={() => openPhase2Modal(s, s.enrollments.find(e => e.course_name === 'Online Filmmaking Course').id)}
                            className="btn"
                            style={{ padding: '0.5rem', background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }}
                            title="Phase 2: Shooting & Editing Attendance"
                          >
                            <Clapperboard size={16} />
                          </button>
                        )}


                        <button onClick={() => openEditModal(s)} className="btn" style={{ padding: '0.5rem', background: 'rgba(56, 189, 248, 0.1)', color: '#0284c7', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} title="Edit Student">
                          <Edit size={16} />
                        </button>
                        <button onClick={() => confirmDeleteStudent(s.id, s.full_name, s.batch_number)} className="btn" style={{ padding: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', transition: 'all 0.2s' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} title="Delete Student">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan="7" style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ width: '48px', height: '48px', background: 'var(--glass-bg)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <UserCheck size={24} style={{ color: 'var(--text-muted)' }} />
                        </div>
                        <span>No students registered yet.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit Modal Overlay */}
      {editingStudent && createPortal(
        <div className="modern-modal-overlay">
          <form onSubmit={submitEdit} className="modern-modal-content glass-panel shadow-2xl" style={{ width: '100%', maxWidth: '500px', margin: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modern-modal-header">
              <h3 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Edit className="text-accent" /> Edit Student Details
              </h3>
              <button type="button" className="icon-btn-ghost" onClick={() => setEditingStudent(null)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            
            <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '60vh', overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>First Name</label>
                  <input type="text" name="firstName" value={editFormData.firstName} onChange={handleEditChange} className="input-glass" required />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Last Name</label>
                  <input type="text" name="lastName" value={editFormData.lastName} onChange={handleEditChange} className="input-glass" required />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Email</label>
                  <input type="email" name="email" value={editFormData.email} onChange={handleEditChange} className="input-glass" required style={{ paddingLeft: '1rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Mobile Number</label>
                  <input type="text" name="mobileNumber" value={editFormData.mobileNumber} onChange={handleEditChange} className="input-glass" placeholder="+880..." style={{ paddingLeft: '1rem' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Username</label>
                  <input type="text" name="username" value={editFormData.username} onChange={handleEditChange} className="input-glass" required style={{ paddingLeft: '1rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Batch Number</label>
                  <input type="text" name="batchNumber" value={editFormData.batchNumber} onChange={handleEditChange} className="input-glass" style={{ paddingLeft: '1rem' }} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>SN No. (2 digits)</label>
                  <input type="text" name="snNo" value={editFormData.snNo} onChange={handleEditChange} className="input-glass" style={{ paddingLeft: '1rem' }} placeholder="e.g. 05" />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Year (4 digits)</label>
                  <input type="text" name="year" value={editFormData.year} onChange={handleEditChange} className="input-glass" style={{ paddingLeft: '1rem' }} placeholder="e.g. 2024" />
                </div>
              </div>


              {/* Enrolled Courses */}
              <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginTop: '0.25rem' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Enrolled Courses</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem' }}>
                  {availableCourses.map(course => (
                    <label key={course.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', background: (editFormData.courses || []).includes(course.name) ? 'rgba(56, 189, 248, 0.1)' : 'transparent', padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid', borderColor: (editFormData.courses || []).includes(course.name) ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)', transition: 'all 0.2s' }}>
                      <input
                        type="checkbox"
                        checked={(editFormData.courses || []).includes(course.name)}
                        onChange={() => handleEditCourseChange(course.name)}
                        style={{ width: '15px', height: '15px' }}
                      />
                      <span style={{ fontSize: '0.85rem' }}>{course.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* ── Dynamic Course Fee Section ─────────────────────────── */}
              {(editFormData.courses || []).length > 0 && (
                <div style={{ padding: '1rem', background: 'rgba(201,168,76,0.04)', borderRadius: '12px', border: '1px solid rgba(201,168,76,0.18)', marginTop: '0.25rem' }}>
                  <h3 style={{ fontSize: '0.95rem', marginBottom: '0.9rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>💰</span> Course Fee Details
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    {(editFormData.courses || []).map(courseName => {
                      const isOFC = courseName === 'Online Filmmaking Course';
                      return (
                        <div key={courseName} style={{ padding: '0.8rem', background: 'rgba(255,255,255,0.025)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
                          <p style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '0.7rem', letterSpacing: '0.01em' }}>{courseName}</p>
                          {isOFC ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                              <FeeRow 
                                courseName={courseName}
                                label="Phase 1" 
                                phaseKey="phase1" 
                                feeData={editFormData.course_fees}
                                onChange={handleCourseFeeChange}
                                onDiscountBlur={handleDiscountBlur}
                                onRemoveInstallment={handleRemoveInstallment}
                                onInstallmentChange={handleInstallmentChange}
                              />
                              {(() => {
                                const ofcEnr = editingStudent?.enrollments?.find(e => e.course_name === 'Online Filmmaking Course');
                                const isPhase1Passed = ofcEnr ? ofcEnr.step2_completed === 1 : false;
                                return (
                                  <FeeRow 
                                    courseName={courseName}
                                    label="Phase 2" 
                                    phaseKey="phase2" 
                                    feeData={editFormData.course_fees}
                                    onChange={handleCourseFeeChange}
                                    onDiscountBlur={handleDiscountBlur}
                                    onRemoveInstallment={handleRemoveInstallment}
                                    onInstallmentChange={handleInstallmentChange}
                                    disabled={!isPhase1Passed}
                                  />
                                );
                              })()}
                            </div>
                          ) : (
                            <FeeRow 
                              courseName={courseName}
                              label={null} 
                              phaseKey={null} 
                              feeData={editFormData.course_fees}
                              onChange={handleCourseFeeChange}
                              onDiscountBlur={handleDiscountBlur}
                              onRemoveInstallment={handleRemoveInstallment}
                              onInstallmentChange={handleInstallmentChange}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {editError && <div className="error-alert" style={{ marginTop: '0.5rem' }}>{editError}</div>}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setEditingStudent(null)} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="modern-btn modern-btn--primary" disabled={isEditing} style={{ flex: 1 }}>
                {isEditing ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {confirmConfig && typeof document !== 'undefined' && createPortal(
        <div className="modern-modal-overlay">
          <div className="modern-modal-content glass-panel shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <h3 className="font-display">{confirmConfig.title}</h3>
              <button className="icon-btn-ghost" onClick={() => setConfirmConfig(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="modern-modal-body">
              <p>{confirmConfig.message}</p>
            </div>
            <div className="modern-modal-footer">
              {!confirmConfig.isAlert && (
                <button className="modern-btn modern-btn--secondary" onClick={() => setConfirmConfig(null)}>Cancel</button>
              )}
              <button 
                className={`modern-btn ${confirmConfig.type === 'danger' ? 'modern-btn--danger' : 'modern-btn--primary'}`}
                style={confirmConfig.isAlert ? { width: '100%', maxWidth: '200px', margin: '0 auto' } : {}}
                onClick={() => {
                  confirmConfig.onConfirm();
                  setConfirmConfig(null);
                }}
              >
                {confirmConfig.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Academic Records Modal */}
      {academicStudent && typeof document !== 'undefined' && createPortal(
        <div className="modern-modal-overlay">
          <form onSubmit={submitAcademic} className="modern-modal-content glass-panel shadow-2xl" style={{ width: '100%', maxWidth: '500px', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <div>
                <h3 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <GraduationCap size={24} style={{ color: '#10b981' }} /> {academicStudent.enrollment?.course_name !== 'Online Filmmaking Course' ? 'Exam Result' : 'Academic Records'}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
                  {academicStudent.full_name} <span style={{ opacity: 0.7 }}>({academicStudent.batch_number ? `${getOrdinalSuffix(academicStudent.batch_number)} Batch` : 'No Batch'})</span>
                </p>
                <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: '500', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '0.2rem 0.6rem', borderRadius: '6px', display: 'inline-block' }}>
                  {academicStudent.enrollment?.course_name || 'Course'}
                </p>
              </div>
              <button type="button" className="icon-btn-ghost" onClick={closeAcademicModal} aria-label="Close"><X size={20} /></button>
            </div>

            <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxHeight: '60vh', overflowY: 'auto' }}>
              {academicStudent.enrollment?.course_name !== 'Online Filmmaking Course' ? (
                /* Film Appreciation Course: single Exam Result out of 100, no attendance */
                <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Exam Result (Total: 100)</h3>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Written Exam Score (Max: 100)</label>
                    <input type="number" name="exam_written" value={academicFormData.exam_written} onChange={handleAcademicChange} min="0" max="100" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                  </div>
                  {(() => {
                    const totalGained = parseInt(academicFormData.exam_written) || 0;
                    const isPassed = totalGained >= 33;
                    return (
                      <p style={{ 
                        fontSize: '0.75rem', 
                        color: 'var(--text-muted)', 
                        marginTop: '1.25rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.5rem'
                      }}>
                        <span>Requires 33+ marks to pass.</span>
                        <span style={{ 
                          fontSize: '0.85rem', 
                          fontWeight: '700', 
                          color: isPassed ? '#34d399' : '#f87171',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}>
                          <span>Total Gained:</span>
                          <strong style={{ fontSize: '0.98rem' }}>{totalGained}</strong>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>/ 100</span>
                          <span style={{ 
                            fontSize: '0.68rem', 
                            fontWeight: '600', 
                            padding: '0.05rem 0.35rem', 
                            borderRadius: '4px',
                            marginLeft: '0.25rem',
                            background: isPassed ? 'rgba(52, 211, 153, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                            color: isPassed ? '#34d399' : '#f87171',
                            border: isPassed ? '1px solid rgba(52, 211, 153, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)'
                          }}>
                            {isPassed ? 'Passed' : 'Failed'}
                          </span>
                        </span>
                      </p>
                    );
                  })()}
                </div>
              ) : (
                /* Online Filmmaking Course: attendance & full breakdown */
                <>
                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', margin: 0 }}>Attendance</h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Total classes:</label>
                        <input type="number" name="attendance_total" value={academicFormData.attendance_total} onChange={handleAcademicChange} min="1" className="input-glass" style={{ width: '100px', paddingLeft: '0.5rem', fontSize: '0.9rem' }} required />
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Classes Attended</label>
                      <input type="number" name="attendance_classes" value={academicFormData.attendance_classes} onChange={handleAcademicChange} min="0" max={academicFormData.attendance_total || 22} className="input-glass" style={{ paddingLeft: '1rem' }} required />
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Requires {Math.ceil((academicFormData.attendance_total || 22) * 0.8)}+ (80%) to qualify for exam.</p>
                    </div>
                  </div>

                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Exam Results (Total: 100)</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Written Exam (Max: 80)</label>
                        <input type="number" name="exam_written" value={academicFormData.exam_written} onChange={handleAcademicChange} min="0" max="80" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Screenplay (Max: 10)</label>
                          <input type="number" name="assignment_screenplay" value={academicFormData.assignment_screenplay} onChange={handleAcademicChange} min="0" max="10" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                        </div>
                        <div>
                          <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Shooting Script (Max: 10)</label>
                          <input type="number" name="assignment_shooting_script" value={academicFormData.assignment_shooting_script} onChange={handleAcademicChange} min="0" max="10" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                        </div>
                      </div>
                    </div>
                    {(() => {
                      const totalGained = (parseInt(academicFormData.exam_written) || 0) + 
                                          (parseInt(academicFormData.assignment_screenplay) || 0) + 
                                          (parseInt(academicFormData.assignment_shooting_script) || 0);
                      const isPassed = totalGained >= 33;
                      return (
                        <p style={{ 
                          fontSize: '0.75rem', 
                          color: 'var(--text-muted)', 
                          marginTop: '1.25rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '0.5rem'
                        }}>
                          <span>Requires 33+ total marks to pass.</span>
                          <span style={{ 
                            fontSize: '0.85rem', 
                            fontWeight: '700', 
                            color: isPassed ? '#34d399' : '#f87171',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.3rem'
                          }}>
                            <span>Total Gained:</span>
                            <strong style={{ fontSize: '0.98rem' }}>{totalGained}</strong>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>/ 100</span>
                            <span style={{ 
                              fontSize: '0.68rem', 
                              fontWeight: '600', 
                              padding: '0.05rem 0.35rem', 
                              borderRadius: '4px',
                              marginLeft: '0.25rem',
                              background: isPassed ? 'rgba(52, 211, 153, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                              color: isPassed ? '#34d399' : '#f87171',
                              border: isPassed ? '1px solid rgba(52, 211, 153, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)'
                            }}>
                              {isPassed ? 'Passed' : 'Failed'}
                            </span>
                          </span>
                        </p>
                      );
                    })()}
                  </div>
                </>
              )}

              {academicError && <div className="error-alert" style={{ marginTop: '0.5rem' }}>{academicError}</div>}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={closeAcademicModal} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="modern-btn modern-btn--primary" disabled={isAcademicSaving} style={{ flex: 1, background: '#10b981', borderColor: '#10b981' }}>
                {isAcademicSaving ? 'Saving...' : (academicStudent.enrollment?.course_name !== 'Online Filmmaking Course' ? 'Save Result' : 'Save Records')}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* Phase 2 Completion Modal */}
      {phase2Student && typeof document !== 'undefined' && createPortal(
        <div className="modern-modal-overlay">
          <form onSubmit={submitPhase2} className="modern-modal-content glass-panel shadow-2xl" style={{ width: '100%', maxWidth: '480px', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <div>
                <h3 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <GraduationCap size={24} style={{ color: '#8b5cf6' }} /> Phase 2: Completed Course
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
                  {phase2Student.full_name} <span style={{ opacity: 0.7 }}>({phase2Student.batch_number ? `${getOrdinalSuffix(phase2Student.batch_number)} Batch` : 'No Batch'})</span>
                </p>
                <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: '500', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.2)', padding: '0.2rem 0.6rem', borderRadius: '6px', display: 'inline-block' }}>
                  Online Filmmaking Course
                </p>
              </div>
              <button type="button" className="icon-btn-ghost" onClick={closePhase2Modal} aria-label="Close"><X size={20} /></button>
            </div>

            <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                Mark the parts the student has participated in. Step 4 (Phase 2: Completed Course) will be automatically checked once <strong style={{ color: 'var(--text-primary)' }}>both</strong> Shooting and Editing are attended.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                {/* Shooting */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', padding: '1rem', borderRadius: '10px', border: '1px solid', borderColor: phase2FormData.phase2_shooting_attended ? '#8b5cf6' : 'rgba(255,255,255,0.1)', background: phase2FormData.phase2_shooting_attended ? 'rgba(139,92,246,0.08)' : 'transparent', transition: 'all 0.2s' }}>
                  <input
                    type="checkbox"
                    checked={phase2FormData.phase2_shooting_attended}
                    onChange={(e) => setPhase2FormData({ ...phase2FormData, phase2_shooting_attended: e.target.checked })}
                    style={{ width: '20px', height: '20px', accentColor: '#8b5cf6', flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem' }}>🎬 Shooting</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Student participated in the Shooting part of Phase 2</div>
                  </div>
                </label>

                {/* Editing */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', padding: '1rem', borderRadius: '10px', border: '1px solid', borderColor: phase2FormData.phase2_editing_attended ? '#8b5cf6' : 'rgba(255,255,255,0.1)', background: phase2FormData.phase2_editing_attended ? 'rgba(139,92,246,0.08)' : 'transparent', transition: 'all 0.2s' }}>
                  <input
                    type="checkbox"
                    checked={phase2FormData.phase2_editing_attended}
                    onChange={(e) => setPhase2FormData({ ...phase2FormData, phase2_editing_attended: e.target.checked })}
                    style={{ width: '20px', height: '20px', accentColor: '#8b5cf6', flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '1rem' }}>✂️ Editing</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Student participated in the Editing part of Phase 2</div>
                  </div>
                </label>
              </div>

              {/* Auto-complete status indicator */}
              <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', background: (phase2FormData.phase2_shooting_attended && phase2FormData.phase2_editing_attended) ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.06)', border: '1px solid', borderColor: (phase2FormData.phase2_shooting_attended && phase2FormData.phase2_editing_attended) ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {(phase2FormData.phase2_shooting_attended && phase2FormData.phase2_editing_attended) ? (
                  <><CheckSquare size={16} style={{ color: '#10b981', flexShrink: 0 }} /><span style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: '600' }}>Both parts attended — Phase 2: Completed Course will be marked ✓</span></>
                ) : (
                  <><Square size={16} style={{ color: '#ef4444', flexShrink: 0 }} /><span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Both Shooting and Editing must be attended to complete Phase 2.</span></>
                )}
              </div>

              {phase2Error && <div className="error-alert" style={{ marginTop: '0.5rem' }}>{phase2Error}</div>}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={closePhase2Modal} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="modern-btn modern-btn--primary" disabled={isPhase2Saving} style={{ flex: 1, background: '#8b5cf6', borderColor: '#8b5cf6' }}>
                {isPhase2Saving ? 'Saving...' : 'Save Attendance'}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      <style>{`
        .student-manager-table-scroll {
          padding: 0 !important;
          overflow-x: auto !important;
          scrollbar-width: thin;
          scrollbar-color: rgba(148, 163, 184, 0.72) rgba(148, 163, 184, 0.12);
          touch-action: pan-x pan-y;
        }
        .student-manager-table {
          width: 100%;
          table-layout: fixed;
        }
        .student-manager-table th,
        .student-manager-table td {
          padding: 0.95rem 0.75rem !important;
        }
        .student-manager-table .student-table-col-id {
          width: 9%;
          white-space: nowrap;
        }
        .student-manager-table .student-table-col-name {
          width: 24%;
        }
        .student-manager-table .student-table-col-contact {
          width: 23%;
        }
        .student-manager-table .student-table-col-batch {
          width: 9%;
          white-space: nowrap;
        }
        .student-manager-table .student-table-col-progress {
          width: 17%;
        }
        .student-manager-table .student-table-col-joined {
          width: 8%;
          white-space: nowrap;
        }
        .student-manager-table .student-table-col-actions {
          width: 13%;
        }
        .student-table-batch-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
        }
        .student-table-course-card {
          min-width: 0;
          width: 100%;
        }
        .student-table-actions {
          flex-wrap: nowrap;
          min-width: max-content;
        }
        .student-manager-table-scroll::-webkit-scrollbar {
          height: 12px;
        }
        .student-manager-table-scroll::-webkit-scrollbar-track {
          background: rgba(148, 163, 184, 0.12);
          border-radius: 999px;
        }
        .student-manager-table-scroll::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.72);
          border-radius: 999px;
          border: 2px solid rgba(15, 23, 42, 0.12);
        }
        .student-manager-table-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(96, 165, 250, 0.82);
        }
        @media (max-width: 1600px) {
          .student-manager-table-scroll {
            width: 100% !important;
            max-width: 100% !important;
            max-height: min(58vh, 420px);
            overflow: auto !important;
            margin-left: 0;
            margin-right: 0;
            overscroll-behavior: contain;
          }
          .student-manager-table {
            width: max-content;
            min-width: 1320px;
            table-layout: auto;
          }
          .student-manager-table th {
            position: sticky;
            top: 0;
            z-index: 2;
            background: rgba(15, 15, 18, 0.96);
          }
          [data-mode="light"] .student-manager-table th {
            background: rgba(255, 255, 255, 0.96);
          }
          .student-manager-table th,
          .student-manager-table td {
            padding: 1rem 1.25rem !important;
          }
          .student-manager-table .student-table-col-id {
            min-width: 120px;
            width: auto;
          }
          .student-manager-table .student-table-col-name {
            min-width: 220px;
            width: auto;
          }
          .student-manager-table .student-table-col-contact {
            min-width: 280px;
            width: auto;
          }
          .student-manager-table .student-table-col-batch {
            min-width: 130px;
            width: auto;
          }
          .student-manager-table .student-table-col-progress {
            min-width: 260px;
            width: auto;
          }
          .student-manager-table .student-table-col-joined {
            min-width: 130px;
            width: auto;
          }
          .student-manager-table .student-table-col-actions {
            min-width: 220px;
            width: auto;
          }
          .student-table-course-card {
            max-width: 210px;
          }
        }
      `}</style>

    </div>
  );
}
