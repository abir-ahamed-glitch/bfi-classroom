import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
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
  UserX, BookOpen, ShieldCheck, Search, X, ChevronRight, ChevronLeft,
  CheckSquare, Square, Edit, Lock, Clapperboard, MessageSquare, XCircle
} from 'lucide-react';
import { getOrdinalSuffix } from '../../utils/formatUtils';
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
  if (typeof n !== 'number') return n;
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatCurrency(n) {
  if (!n) return '৳0';
  return '৳' + n.toLocaleString('en-BD');
}

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
  const rawRemainingDue = Math.max(0, fullFeeNum - discountNum - amountPaidNum);

  const installments = data.installments || [];
  const remainingDue = installments.length > 0
    ? installments.filter(inst => (inst.status || '').toLowerCase() !== 'paid').reduce((sum, inst) => sum + (parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) || 0), 0)
    : rawRemainingDue;
  
  const hasError = amountPaidNum > fullFeeNum;
  const hasSumError = (amountPaidNum + discountNum) > fullFeeNum;

  const isFullySatisfied = fullFeeNum > 0 && amountPaidNum + discountNum >= fullFeeNum;
  const allInstallmentsPaid = rawRemainingDue > 0 && 
    installments.length > 0 && 
    installments.every(inst => inst.status === 'Paid');
  const isFullyCompleted = isFullySatisfied || allInstallmentsPaid || remainingDue === 0;

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

      {/* Installment Section: only shows if rawRemainingDue > 0 or there are existing installments */}
      {(rawRemainingDue > 0 || installments.length > 0) && (
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
  'students/admitted-phase2': {
    title: 'Admitted Students - Phase 2',
    subtitle: 'Students admitted into Phase 2',
    columns: [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
      ['admitted_date', 'Admitted Date'],
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
      ['downloads_count', 'Downloads'],
    ],
  },
  'students/attendance': {
    title: 'Class Attendance (1st Phase)',
    subtitle: 'Students and their attendance qualifications (requires >= 80% to qualify)',
    columns: [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
      ['attendance_classes', 'Classes Attended'],
      ['attendance_total', 'Total Classes'],
      ['attendance_percentage', 'Attendance %'],
      ['attendance_status', 'Status'],
    ],
  },
  'students/assignments': {
    title: 'Assignment: Phase 1',
    subtitle: 'Detailed assignment scores and submission statuses for Screenplay and Shooting Script',
    columns: [], // Dynamically generated
  },
  'students/phase2-attendance': {
    title: 'Shooting & Editing Attendance',
    subtitle: 'Detailed Phase 2 shooting and editing attendance list',
    columns: [], // Dynamically generated
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
  const [attendanceFilter, setAttendanceFilter] = useState('qualified'); // 'qualified' | 'not_qualified'
  const [assignmentFilter, setAssignmentFilter] = useState('screenplay'); // 'screenplay' | 'shooting_script' | 'not_submitted'
  const [phase2AttendanceFilter, setPhase2AttendanceFilter] = useState('shooting'); // 'shooting' | 'editing'

  // ── Student List & Action Modals States ────────────────────
  const [students, setStudents] = useState([]);

  const availableCourses = [
    { name: 'Online Filmmaking Course', type: 'filmmaking' },
    { name: 'Film Appreciation Course', type: 'workshop' },
    { name: 'Script Writing', type: 'workshop' },
    { name: 'Cinematography', type: 'workshop' },
    { name: 'Acting', type: 'workshop' }
  ];

  // Edit Modal State
  const [editingStudent, setEditingStudent] = useState(null);
  const [editFormData, setEditFormData] = useState({
    firstName: '', lastName: '', email: '', username: '', batchNumber: '', mobileNumber: '',
    phase1_fee: '', phase2_fee: '',
    course_fees: {},
    discount: '',
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

  // Confirm Modal State
  const [confirmConfig, setConfirmConfig] = useState(null);


  const fetchDrawerData = useCallback(async () => {
    if (!activeDrawer) return;
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
  }, [activeDrawer]);

  // Fetch drawer details on open
  useEffect(() => {
    if (!activeDrawer) {
      setDrawerData([]);
      setDrawerSearch('');
      return;
    }

    fetchDrawerData();
  }, [activeDrawer, fetchDrawerData]);



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

  // ── Students Management Handlers ────────────────────────────
  const fetchStudents = async () => {
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
      const rawRemainingDue = Math.max(0, fullFeeNum - discountNum - amountPaidNum);
      
      const phase1Installments = phase1.installments || [];
      const remainingDue = phase1Installments.length > 0
        ? phase1Installments.filter(inst => (inst.status || '').toLowerCase() !== 'paid').reduce((sum, inst) => sum + (parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) || 0), 0)
        : rawRemainingDue;
      
      const phase1PaidAny = amountPaidNum > 0 || phase1Installments.some(inst => inst.status === 'Paid' && parseFloat((inst.amount || '').replace(/[^\d.]/g, '')) > 0);
      const phase1FullyPaid = (fullFeeNum > 0 && amountPaidNum + discountNum >= fullFeeNum) ||
        (fullFeeNum > 0 && rawRemainingDue > 0 && phase1Installments.length > 0 && phase1Installments.every(inst => inst.status === 'Paid')) ||
        (fullFeeNum > 0 && remainingDue === 0);

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
        if (willBeChecked) {
          if (!e?.step1_completed) {
            setConfirmConfig({ title: 'Action Restricted', message: 'Cannot check "Completed Course" because "Admission Confirmed" is not yet completed.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
            return;
          }
          openAcademicModal(student, enrollmentId);
          return;
        }
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
        fetchAll(true);
      } else {
        const data = await res.json();
        setConfirmConfig({ title: 'Update Failed', message: data.error || 'Failed to update progress.', confirmText: 'OK', isAlert: true, onConfirm: () => {} });
      }
    } catch (err) {
      console.error('Progress update error', err);
    }
  };

  const openAcademicModal = (student, courseId) => {
    setAcademicError('');
    const enrollment = student.enrollments.find(e => e.id === courseId);
    const isOnlineFilmmaking = enrollment?.course_name === 'Online Filmmaking Course';
    const isAdmitted = isOnlineFilmmaking ? enrollment?.step3_completed : enrollment?.step1_completed;

    if (!isAdmitted) {
      setConfirmConfig({
        title: 'Action Restricted',
        message: isOnlineFilmmaking
          ? 'Cannot update academic records because Phase 2: Admitted is not yet completed.'
          : 'Cannot update exam results because Admission Confirmed is not yet completed.',
        confirmText: 'OK',
        isAlert: true,
        onConfirm: () => {}
      });
      return;
    }

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

  const getAcademicValidationError = () => {
    if (!academicStudent) return null;
    const isOnlineFilmmaking = academicStudent.enrollment?.course_name === 'Online Filmmaking Course';
    if (!isOnlineFilmmaking) {
      const exam = parseInt(academicFormData.exam_written) || 0;
      if (exam > 100) return 'Written exam score cannot exceed 100.';
      if (exam < 0) return 'Written exam score cannot be negative.';
    } else {
      const attendance = parseInt(academicFormData.attendance_classes) || 0;
      const totalAttendance = parseInt(academicFormData.attendance_total) || 22;
      const exam = parseInt(academicFormData.exam_written) || 0;
      const screenplay = parseInt(academicFormData.assignment_screenplay) || 0;
      const shootingScript = parseInt(academicFormData.assignment_shooting_script) || 0;

      if (attendance > totalAttendance) return 'Attended classes cannot exceed total classes.';
      if (attendance < 0) return 'Attended classes cannot be negative.';
      if (totalAttendance < 1) return 'Total classes must be at least 1.';
      
      if (exam > 80) return 'Written exam score cannot exceed 80.';
      if (exam < 0) return 'Written exam score cannot be negative.';
      
      if (screenplay > 10) return 'Screenplay assignment score cannot exceed 10.';
      if (screenplay < 0) return 'Screenplay assignment score cannot be negative.';
      
      if (shootingScript > 10) return 'Shooting script assignment score cannot exceed 10.';
      if (shootingScript < 0) return 'Shooting script assignment score cannot be negative.';
    }
    return null;
  };

  const submitAcademic = async (e) => {
    e.preventDefault();
    setIsAcademicSaving(true);
    setAcademicError('');

    const valError = getAcademicValidationError();
    if (valError) {
      setAcademicError(valError);
      setIsAcademicSaving(false);
      return;
    }

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
      fetchAll(true);
      if (activeDrawer) {
        try {
          const d = await apiFetch(`/${activeDrawer}`);
          setDrawerData(d);
        } catch (drawerErr) {
          console.error('[Analytics] Failed to refresh drawer after academic update:', drawerErr);
        }
      }
      closeAcademicModal();
    } catch (err) {
      setAcademicError(err.message);
    } finally {
      setIsAcademicSaving(false);
    }
  };

  const handleAcademicChange = (e) => {
    setAcademicFormData({ ...academicFormData, [e.target.name]: e.target.value });
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
      fetchAll(true);
      closePhase2Modal();
    } catch (err) {
      setPhase2Error(err.message);
    } finally {
      setIsPhase2Saving(false);
    }
  };

  // ---- Edit Modal handlers ----
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

  const handleEditChange = (e) => setEditFormData({ ...editFormData, [e.target.name]: e.target.value });

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
      fetchAll(true);
    } catch (err) {
      setEditError(err.message);
    } finally {
      setIsEditing(false);
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
    const basePath = activeDrawer ? activeDrawer.split('?')[0] : null;
    if (STAT_DRAWERS[basePath]) return STAT_DRAWERS[basePath].title;
    
    const urlParams = new URLSearchParams(activeDrawer && activeDrawer.includes('?') ? activeDrawer.substring(activeDrawer.indexOf('?')) : '');
    const status = urlParams.get('status');

    switch (basePath) {
      case 'pending-certificates': return 'Certificates Pending Auto-Issuance';
      case 'inactive-students': return 'Inactive Students';
      case 'failed-students': return 'Failed / Did Not Pass Exam';
      case 'missing-attendance': return 'Missing Phase 2 Attendance';
      case 'unpaid-students': 
        if (status === 'paid') return 'Paid Students';
        if (status === 'partial') return 'Partially Paid Students';
        return 'Unpaid Students';
      default: return 'Detail List';
    }
  };

  const getDrawerSubtitle = () => {
    const basePath = activeDrawer ? activeDrawer.split('?')[0] : null;
    if (STAT_DRAWERS[basePath]) return STAT_DRAWERS[basePath].subtitle;

    const urlParams = new URLSearchParams(activeDrawer && activeDrawer.includes('?') ? activeDrawer.substring(activeDrawer.indexOf('?')) : '');
    const status = urlParams.get('status');

    switch (basePath) {
      case 'pending-certificates': return 'Eligible students with no certificate issued yet';
      case 'inactive-students': return 'Students with no login activity in the last 30 days';
      case 'failed-students': return 'Registered students who have not yet passed the Phase 1 Exam';
      case 'missing-attendance': return 'Filmmaking students who are missing phase 2 shooting or editing attendance';
      case 'unpaid-students': 
        if (status === 'paid') return 'Students who have fully paid all course fees';
        if (status === 'partial') return 'Students who have partially paid course fees';
        return 'Students with outstanding unpaid fee statuses';
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

  const basePath = activeDrawer ? activeDrawer.split('?')[0] : null;
  let statisticsDrawer = STAT_DRAWERS[basePath];
  if (basePath === 'students/assignments') {
    let cols = [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
    ];
    if (assignmentFilter === 'screenplay') {
      cols.push(['assignment_screenplay', 'Screenplay Score']);
    } else if (assignmentFilter === 'shooting_script') {
      cols.push(['assignment_shooting_script', 'Shooting Script Score']);
    } else {
      cols.push(['screenplay_status', 'Screenplay Status']);
      cols.push(['shooting_script_status', 'Shooting Script Status']);
    }
    statisticsDrawer = {
      ...statisticsDrawer,
      columns: cols
    };
  }
  if (basePath === 'students/phase2-attendance') {
    let cols = [
      ['name', 'Name'],
      ['student_id', 'Student ID'],
      ['batch_number', 'Batch'],
    ];
    if (phase2AttendanceFilter === 'shooting') {
      cols.push(['phase2_shooting_attended', 'Shooting Attendance']);
    } else {
      cols.push(['phase2_editing_attended', 'Editing Attendance']);
    }
    statisticsDrawer = {
      ...statisticsDrawer,
      columns: cols
    };
  }

  const displayDrawerData = filteredDrawerData.filter(row => {
    if (basePath === 'students/attendance') {
      return row.attendance_status === (attendanceFilter === 'qualified' ? 'Qualified' : 'Not Qualified');
    }
    if (basePath === 'students/assignments') {
      if (assignmentFilter === 'screenplay') {
        return row.assignment_screenplay > 0;
      } else if (assignmentFilter === 'shooting_script') {
        return row.assignment_shooting_script > 0;
      } else if (assignmentFilter === 'not_submitted') {
        return row.assignment_screenplay === 0 || row.assignment_shooting_script === 0;
      }
    }
    return true;
  });

  const renderStatisticsCell = (row, field) => {
    if (field === 'name') {
      return row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'N/A';
    }
    if (field === 'exam_score') {
      return row[field] != null ? row[field] : 'N/A';
    }
    if (field === 'phase2_shooting_attended' || field === 'phase2_editing_attended') {
      const attended = row[field] === 1 || row[field] === true;
      return (
        <span style={{
          padding: '0.2rem 0.5rem',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: '600',
          background: attended ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          color: attended ? '#10b981' : '#ef4444'
        }}>
          {attended ? 'Attended' : 'Not Attended'}
        </span>
      );
    }
    if (field === 'assignment_screenplay' || field === 'assignment_shooting_script') {
      return row[field] != null ? `${row[field]} / 10` : '0 / 10';
    }
    if (field === 'screenplay_status') {
      const isSubmitted = row.assignment_screenplay > 0;
      return (
        <span style={{
          padding: '0.2rem 0.5rem',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: '600',
          background: isSubmitted ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          color: isSubmitted ? '#10b981' : '#ef4444'
        }}>
          {isSubmitted ? `Submitted (${row.assignment_screenplay}/10)` : 'Not Submitted'}
        </span>
      );
    }
    if (field === 'shooting_script_status') {
      const isSubmitted = row.assignment_shooting_script > 0;
      return (
        <span style={{
          padding: '0.2rem 0.5rem',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: '600',
          background: isSubmitted ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          color: isSubmitted ? '#10b981' : '#ef4444'
        }}>
          {isSubmitted ? `Submitted (${row.assignment_shooting_script}/10)` : 'Not Submitted'}
        </span>
      );
    }
    if (field === 'attendance_percentage') {
      return row[field] != null ? `${row[field]}%` : 'N/A';
    }
    if (field === 'attendance_status') {
      const isQualified = row[field] === 'Qualified';
      return (
        <span style={{
          padding: '0.2rem 0.5rem',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: '600',
          background: isQualified ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          color: isQualified ? '#10b981' : '#ef4444'
        }}>
          {row[field] || 'N/A'}
        </span>
      );
    }
    if (field === 'downloads_count') {
      const count = row.downloads_count || 0;
      if (count === 0) {
        return (
          <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            0 <span className="analytics-download-badge-text">downloads</span>
          </span>
        );
      }
      const historyStr = row.downloads
        ? row.downloads.map(d => {
            const dateStr = d.downloaded_at.includes('T') ? d.downloaded_at : d.downloaded_at.replace(' ', 'T');
            const utcStr = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
            return new Date(utcStr).toLocaleString();
          }).join('\n')
        : '';
      return (
        <span 
          title={historyStr}
          style={{
            cursor: 'help',
            padding: '0.2rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: '600',
            background: 'rgba(56, 189, 248, 0.1)',
            color: 'var(--accent-secondary)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            whiteSpace: 'nowrap'
          }}
        >
          {count} <span className="analytics-download-badge-text">{count === 1 ? 'download' : 'downloads'}</span>
        </span>
      );
    }
    if (DATE_DRAWER_FIELDS.has(field)) {
      return row[field] ? new Date(row[field]).toLocaleDateString() : 'N/A';
    }
    return row[field] != null ? row[field] : 'N/A';
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

  // Socket.io connection for live updates on certificate download
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    const token = localStorage.getItem('token');
    const socket = io(socketUrl, { auth: { token }, transports: ['websocket', 'polling'] });

    socket.on('certificate_downloaded', (payload) => {
      console.log('[Analytics] Certificate downloaded socket event received:', payload);
      // Re-fetch dashboard stats silently
      fetchAll(true);

      // Re-fetch drawer data if active drawer is certificates-issued
      if (activeDrawer) {
        const basePath = activeDrawer.split('?')[0];
        if (basePath === 'students/certificates-issued') {
          fetchDrawerData();
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [activeDrawer, fetchDrawerData, fetchAll]);

  useEffect(() => {
    fetchStudents();
  }, []);

  const handleRefresh = () => {
    fetchAll(true);
    fetchStudents();
  };

  const getColClass = (field) => {
    if (field === 'student_id') return 'student-table-col-id';
    if (field === 'name') return 'student-table-col-name';
    if (field === 'batch_number') return 'student-table-col-batch';
    return '';
  };

  const renderCourseProgression = (s) => {
    if (!s || !s.enrollments) return <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>N/A</span>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {s.enrollments.map(e => (
          <div key={e.id} className="student-table-course-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(255,255,255,0.01)', padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.course_name}>
              {e.course_name}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              {e.course_type === 'filmmaking' ? (
                <>
                  <button onClick={() => toggleProgress(s.id, e.id, 'step1_completed', e.step1_completed, e.course_name)} title="Phase 1: Admitted" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: e.step1_completed ? '#10b981' : 'var(--text-muted)' }}>
                    {e.step1_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                  {(() => {
                    const isGraded = e.exam_written !== null && e.exam_written !== undefined && e.exam_written !== '';
                    const totalScore = (parseInt(e.exam_written) || 0) + (parseInt(e.assignment_screenplay) || 0) + (parseInt(e.assignment_shooting_script) || 0);
                    const hasFailed = isGraded && e.step1_completed === 1 && e.step2_completed !== 1;
                    if (hasFailed) {
                      return (
                        <button onClick={() => toggleProgress(s.id, e.id, 'step2_completed', e.step2_completed, e.course_name)} title={`Phase 1: Failed (Score: ${totalScore})`} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#ef4444' }}>
                          <XCircle size={18} />
                        </button>
                      );
                    }
                    return (
                      <button onClick={() => toggleProgress(s.id, e.id, 'step2_completed', e.step2_completed, e.course_name)} title="Phase 1: Passed Exam" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: e.step2_completed ? '#10b981' : 'var(--text-muted)' }}>
                        {e.step2_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                      </button>
                    );
                  })()}
                  <div style={{ width: '1px', height: '14px', background: 'rgba(255, 255, 255, 0.1)', margin: '0 0.2rem' }}></div>
                  <button onClick={() => toggleProgress(s.id, e.id, 'step3_completed', e.step3_completed, e.course_name)} title="Phase 2: Admitted" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: e.step3_completed ? '#10b981' : 'var(--text-muted)' }}>
                    {e.step3_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                  <button onClick={() => toggleProgress(s.id, e.id, 'step4_completed', e.step4_completed, e.course_name)} title="Phase 2: Completed Course" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: e.step4_completed ? '#10b981' : 'var(--text-muted)' }}>
                    {e.step4_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => toggleProgress(s.id, e.id, 'step1_completed', e.step1_completed, e.course_name)} title="Admitted" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: e.step1_completed ? '#10b981' : 'var(--text-muted)' }}>
                    {e.step1_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                  {(() => {
                    const isGraded = e.exam_written !== null && e.exam_written !== undefined && e.exam_written !== '';
                    const hasFailed = isGraded && e.step1_completed === 1 && e.step4_completed !== 1;
                    if (hasFailed) {
                      return (
                        <button onClick={() => toggleProgress(s.id, e.id, 'step4_completed', e.step4_completed, e.course_name)} title={`Failed (Score: ${e.exam_written})`} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#ef4444' }}>
                          <XCircle size={18} />
                        </button>
                      );
                    }
                    return (
                      <button onClick={() => toggleProgress(s.id, e.id, 'step4_completed', e.step4_completed, e.course_name)} title="Completed Course" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: e.step4_completed ? '#10b981' : 'var(--text-muted)' }}>
                        {e.step4_completed ? <CheckSquare size={18} /> : <Square size={18} />}
                      </button>
                    );
                  })()}
                </>
              )}
              {e.step4_completed === 1 && hasPendingDueOrPartialPayment(e) && (
                <Lock size={14} style={{ color: '#f87171', display: 'inline-block' }} title="Certificate Locked (Pending/Due/Partial Payment)" />
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const getDrawerCourse = () => {
    if (!activeDrawer) return null;
    const urlParams = new URLSearchParams(activeDrawer.includes('?') ? activeDrawer.substring(activeDrawer.indexOf('?')) : '');
    return urlParams.get('course');
  };

  const renderStudentActions = (s) => {
    if (!s) return null;
    return (
      <div className="student-table-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
        {s.enrollments && s.enrollments.length > 0 && (() => {
          const courseParam = getDrawerCourse();
          const enr = (courseParam && s.enrollments.find(e => e.course_name === courseParam)) || s.enrollments[0];
          const isAppreciation = enr.course_name !== 'Online Filmmaking Course';
          return (
            <button 
              type="button"
              onClick={() => openAcademicModal(s, enr.id)}
              className="analytics-table-action-btn" 
              style={{ padding: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '8px', transition: 'all 0.2s', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} 
              title={isAppreciation ? 'Exam Result' : 'Academic Records'}
            >
              <GraduationCap size={16} />
            </button>
          );
        })()}
        {s.enrollments && s.enrollments.find(enr => enr.course_name === 'Online Filmmaking Course') && (
          <button
            type="button"
            onClick={() => openPhase2Modal(s, s.enrollments.find(enr => enr.course_name === 'Online Filmmaking Course').id)}
            className="analytics-table-action-btn"
            style={{ padding: '0.5rem', background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: '8px', transition: 'all 0.2s', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }}
            title="Phase 2: Shooting & Editing Attendance"
          >
            <Film size={16} />
          </button>
        )}
        <button 
          type="button"
          onClick={() => openEditModal(s)} 
          className="analytics-table-action-btn" 
          style={{ padding: '0.5rem', background: 'rgba(56, 189, 248, 0.1)', color: '#0284c7', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '8px', transition: 'all 0.2s', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} 
          title="Edit Student"
        >
          <Edit size={16} />
        </button>
        <button 
          type="button"
          onClick={() => navigate('/inbox', { state: { selectedUser: { id: s.id, first_name: s.first_name, last_name: s.last_name, role: 'student' } } })} 
          className="analytics-table-action-btn" 
          style={{ padding: '0.5rem', background: 'rgba(167, 139, 250, 0.1)', color: '#8b5cf6', border: '1px solid rgba(167, 139, 250, 0.2)', borderRadius: '8px', transition: 'all 0.2s', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(167, 139, 250, 0.2)'; e.currentTarget.style.transform = 'scale(1.05)'; }} 
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(167, 139, 250, 0.1)'; e.currentTarget.style.transform = 'scale(1)'; }} 
          title="Send Message"
        >
          <MessageSquare size={16} />
        </button>
      </div>
    );
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
          SECTION 2 — Overall Institute & Course Statistics
      ═══════════════════════════════════════════════════════ */}
      {loading ? (
        <div className="analytics-section">
          <p className="analytics-section-title"><TrendingUp size={13} /> Institute Statistics</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1rem' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="analytics-skeleton-card" style={{ height: 76 }} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Global Institute Statistics */}
          <div className="analytics-section">
            <p className="analytics-section-title"><TrendingUp size={13} /> Institute Statistics</p>
            <div className="stats-grid">
              <StatCard 
                icon={<Users size={18} />} 
                iconVariant="blue" 
                value={stats?.institute?.totalRegistered != null ? stats.institute.totalRegistered : stats?.totalRegistered} 
                label="Total Registered Students" 
                active={activeDrawer === 'students/all'} 
                onClick={() => setActiveDrawer('students/all')} 
              />
              <StatCard 
                icon={<BookOpen size={18} />} 
                iconVariant="blue" 
                value={stats?.institute?.totalAdmittedEnrolled != null ? stats.institute.totalAdmittedEnrolled : stats?.currentlyEnrolled} 
                label="Total Admitted / Enrolled Students" 
                active={activeDrawer === 'students/enrolled'} 
                onClick={() => setActiveDrawer('students/enrolled')} 
              />
              <StatCard 
                icon={<CheckCircle size={18} />} 
                iconVariant="green" 
                value={stats?.institute?.totalPassed != null ? stats.institute.totalPassed : stats?.completedPhase2} 
                label="Total Passed Students" 
                active={activeDrawer === 'students/certificates-issued'} 
                onClick={() => setActiveDrawer('students/certificates-issued')} 
              />
              <StatCard 
                icon={<Award size={18} />} 
                iconVariant="green" 
                value={stats?.institute?.certificatesIssued != null ? stats.institute.certificatesIssued : stats?.certificatesIssued} 
                label="Certificates Issued" 
                active={activeDrawer === 'students/certificates-issued'} 
                onClick={() => setActiveDrawer('students/certificates-issued')} 
              />
              <StatCard 
                icon={<UserX size={18} />} 
                iconVariant="red" 
                value={stats?.failedOrDropped} 
                label="Failed / Did Not Pass" 
                active={activeDrawer === 'students/failed-exam'} 
                onClick={() => setActiveDrawer('students/failed-exam')} 
              />
            </div>
          </div>

          {/* Active Course-Specific Statistics */}
          {stats?.courses && stats.courses.map(course => {
            const courseName = course.courseName;
            const courseType = course.courseType;
            const courseStats = course.stats;

            if (courseType === 'filmmaking') {
              return (
                <div key={courseName} className="analytics-section">
                  <p className="analytics-section-title"><Clapperboard size={13} /> {courseName} Statistics</p>
                  <div className="stats-grid">
                    <StatCard 
                      icon={<UserPlus size={18} />} 
                      iconVariant="sky" 
                      value={courseStats.totalAdmitted} 
                      label="Total Admitted (Phase 1)" 
                      active={activeDrawer === `students/admitted?course=${encodeURIComponent(courseName)}`} 
                      onClick={() => setActiveDrawer(`students/admitted?course=${encodeURIComponent(courseName)}`)} 
                    />
                    <StatCard 
                      icon={<CheckSquare size={18} />} 
                      iconVariant="green" 
                      value={
                        <div className="stat-card-value-split">
                          <span style={{ color: '#10b981' }}>Qualified {courseStats.classAttendance1stPhase}</span>
                          <span className="stat-card-value-divider">|</span>
                          <span style={{ color: '#ef4444' }}>Not Qualified {courseStats.classAttendance1stPhaseNotQualified != null ? courseStats.classAttendance1stPhaseNotQualified : (courseStats.totalAdmitted - courseStats.classAttendance1stPhase)}</span>
                        </div>
                      }
                      label="Class Attendance (1st Phase)" 
                      active={activeDrawer === `students/attendance?course=${encodeURIComponent(courseName)}`} 
                      onClick={() => {
                        setAttendanceFilter('qualified');
                        setActiveDrawer(`students/attendance?course=${encodeURIComponent(courseName)}`);
                      }} 
                    />
                    <StatCard 
                      icon={<FileText size={18} />} 
                      iconVariant="sky" 
                      value={
                        <div className="stat-card-value-split">
                          <span style={{ color: '#10b981' }}>Screenplay {courseStats.screenplayCount || 0}</span>
                          <span className="stat-card-value-divider">|</span>
                          <span style={{ color: '#fbbf24' }}>Shooting Script {courseStats.shootingScriptCount || 0}</span>
                        </div>
                      }
                      label="Assignment: Phase 1" 
                      active={activeDrawer === `students/assignments?course=${encodeURIComponent(courseName)}`} 
                      onClick={() => {
                        setAssignmentFilter('screenplay');
                        setActiveDrawer(`students/assignments?course=${encodeURIComponent(courseName)}`);
                      }} 
                    />
                    <StatCard 
                      icon={<ShieldCheck size={18} />} 
                      iconVariant="green" 
                      value={courseStats.passedPhase1Exam} 
                      label="Passed Phase 1 Exam" 
                      active={activeDrawer === `students/passed-exam?course=${encodeURIComponent(courseName)}`} 
                      onClick={() => setActiveDrawer(`students/passed-exam?course=${encodeURIComponent(courseName)}`)} 
                    />
                    <StatCard 
                      icon={<GraduationCap size={18} />} 
                      iconVariant="amber" 
                      value={courseStats.completedPhase1} 
                      label="Completed Phase 1" 
                      active={activeDrawer === `students/completed-phase1?course=${encodeURIComponent(courseName)}`} 
                      onClick={() => setActiveDrawer(`students/completed-phase1?course=${encodeURIComponent(courseName)}`)} 
                    />
                    <StatCard 
                      icon={<UserPlus size={18} />} 
                      iconVariant="sky" 
                      value={courseStats.totalAdmittedPhase2} 
                      label="Total Admitted (Phase 2)" 
                      active={activeDrawer === `students/admitted-phase2?course=${encodeURIComponent(courseName)}`} 
                      onClick={() => setActiveDrawer(`students/admitted-phase2?course=${encodeURIComponent(courseName)}`)} 
                    />
                    <StatCard 
                      icon={<Film size={18} />} 
                      iconVariant="purple" 
                      value={
                        <div className="stat-card-value-split">
                          <span style={{ color: '#10b981' }}>Shooting {courseStats.shootingAttendedCount || 0}</span>
                          <span className="stat-card-value-divider">|</span>
                          <span style={{ color: '#fbbf24' }}>Editing {courseStats.editingAttendedCount || 0}</span>
                        </div>
                      }
                      label="Shooting & Editing Attendance" 
                      active={activeDrawer === `students/phase2-attendance?course=${encodeURIComponent(courseName)}`} 
                      onClick={() => {
                        setPhase2AttendanceFilter('shooting');
                        setActiveDrawer(`students/phase2-attendance?course=${encodeURIComponent(courseName)}`);
                      }} 
                    />
                    <StatCard 
                      icon={<Film size={18} />} 
                      iconVariant="amber" 
                      value={courseStats.completedPhase2} 
                      label="Completed Phase 2" 
                      active={activeDrawer === `students/completed-phase2?course=${encodeURIComponent(courseName)}`} 
                      onClick={() => setActiveDrawer(`students/completed-phase2?course=${encodeURIComponent(courseName)}`)} 
                    />
                  </div>
                </div>
              );
            } else {
              return (
                <div key={courseName} className="analytics-section">
                  <p className="analytics-section-title"><BookOpen size={13} /> {courseName} Statistics</p>
                  <div className="stats-grid">
                    <StatCard 
                      icon={<UserPlus size={18} />} 
                      iconVariant="sky" 
                      value={courseStats.totalAdmitted} 
                      label="Total Admitted / Enrolled" 
                      active={activeDrawer === `students/admitted?course=${encodeURIComponent(courseName)}`} 
                      onClick={() => setActiveDrawer(`students/admitted?course=${encodeURIComponent(courseName)}`)} 
                    />
                    <StatCard 
                      icon={<Award size={18} />} 
                      iconVariant="green" 
                      value={courseStats.completedCourse} 
                      label="Completed Course" 
                      active={activeDrawer === `students/certificates-issued?course=${encodeURIComponent(courseName)}`} 
                      onClick={() => setActiveDrawer(`students/certificates-issued?course=${encodeURIComponent(courseName)}`)} 
                    />
                  </div>
                </div>
              );
            }
          })}
        </>
      )}

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
                  <PieChart margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                    <Pie
                      data={feeData.slices.filter(s => s.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={65}
                      paddingAngle={3}
                      dataKey="value"
                      nameKey="name"
                      label={({ name, percent, x, y, cx }) => {
                        if (percent < 0.05) return null;
                        return (
                          <text
                            x={x}
                            y={y}
                            fill="rgba(255, 255, 255, 0.85)"
                            fontSize={11}
                            fontWeight="500"
                            textAnchor={x > cx ? 'start' : 'end'}
                            dominantBaseline="central"
                          >
                            <tspan x={x} dy="-0.6em">{name}</tspan>
                            <tspan x={x} dy="1.2em">{(percent * 100).toFixed(0)}%</tspan>
                          </text>
                        );
                      }}
                      labelLine={false}
                    >
                      {feeData.slices.filter(s => s.value > 0).map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.color} 
                          style={{ cursor: 'pointer' }}
                          onClick={() => {
                            if (entry.name === 'Fully Paid') setActiveDrawer('unpaid-students?status=paid');
                            else if (entry.name === 'Partially Paid') setActiveDrawer('unpaid-students?status=partial');
                            else if (entry.name === 'Unpaid') setActiveDrawer('unpaid-students?status=unpaid');
                          }}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="fee-pie-summary">
                  <div className="fee-pie-stat" style={{ cursor: 'pointer' }} onClick={() => setActiveDrawer('unpaid-students?status=paid')}>
                    <div className="fee-pie-stat-value" style={{ color: '#22c55e' }}>{formatCurrency(feeData.collectedAmount)}</div>
                    <div className="fee-pie-stat-label">Collected</div>
                  </div>
                  <div className="fee-pie-stat" style={{ cursor: 'pointer' }} onClick={() => setActiveDrawer('unpaid-students?status=unpaid')}>
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
          SECTION 5 — Recent Activity Feed
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
          <button className="analytics-drawer-back-btn" onClick={() => setActiveDrawer(null)}>
            <ChevronLeft size={20} />
            <span>Back</span>
          </button>
          <div className="analytics-drawer-title-group">
            <h2>{getDrawerTitle()}</h2>
            <p>{getDrawerSubtitle()}</p>
          </div>
          <button className="analytics-drawer-close" onClick={() => setActiveDrawer(null)}>
            <X size={20} />
          </button>
        </div>

        <div className="analytics-drawer-content">
          {basePath === 'students/attendance' && (
            <div className="analytics-drawer-filter-group">
              <button
                onClick={() => setAttendanceFilter('qualified')}
                style={{
                  flex: 1,
                  padding: '0.8rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: attendanceFilter === 'qualified' ? '#10b981' : 'rgba(255, 255, 255, 0.08)',
                  background: attendanceFilter === 'qualified' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  color: attendanceFilter === 'qualified' ? '#10b981' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckSquare size={16} />
                  <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>Qualified Student</span>
                </div>
                <span style={{ fontSize: '1.1rem', fontWeight: '800' }}>
                  {drawerData.filter(row => row.attendance_status === 'Qualified').length}
                </span>
              </button>

              <button
                onClick={() => setAttendanceFilter('not_qualified')}
                style={{
                  flex: 1,
                  padding: '0.8rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: attendanceFilter === 'not_qualified' ? '#ef4444' : 'rgba(255, 255, 255, 0.08)',
                  background: attendanceFilter === 'not_qualified' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  color: attendanceFilter === 'not_qualified' ? '#ef4444' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={16} />
                  <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>Not Qualified Student</span>
                </div>
                <span style={{ fontSize: '1.1rem', fontWeight: '800' }}>
                  {drawerData.filter(row => row.attendance_status === 'Not Qualified').length}
                </span>
              </button>
            </div>
          )}

          {basePath === 'students/assignments' && (
            <div className="analytics-drawer-filter-group">
              <button
                onClick={() => setAssignmentFilter('screenplay')}
                style={{
                  flex: 1,
                  padding: '0.8rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: assignmentFilter === 'screenplay' ? '#10b981' : 'rgba(255, 255, 255, 0.08)',
                  background: assignmentFilter === 'screenplay' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  color: assignmentFilter === 'screenplay' ? '#10b981' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <FileText size={16} />
                  <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>Screenplay</span>
                </div>
                <span style={{ fontSize: '1.1rem', fontWeight: '800' }}>
                  {drawerData.filter(row => row.assignment_screenplay > 0).length}
                </span>
              </button>

              <button
                onClick={() => setAssignmentFilter('shooting_script')}
                style={{
                  flex: 1,
                  padding: '0.8rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: assignmentFilter === 'shooting_script' ? '#fbbf24' : 'rgba(255, 255, 255, 0.08)',
                  background: assignmentFilter === 'shooting_script' ? 'rgba(251, 191, 36, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  color: assignmentFilter === 'shooting_script' ? '#fbbf24' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <FileText size={16} />
                  <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>Shooting Script</span>
                </div>
                <span style={{ fontSize: '1.1rem', fontWeight: '800' }}>
                  {drawerData.filter(row => row.assignment_shooting_script > 0).length}
                </span>
              </button>

              <button
                onClick={() => setAssignmentFilter('not_submitted')}
                style={{
                  flex: 1,
                  padding: '0.8rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: assignmentFilter === 'not_submitted' ? '#ef4444' : 'rgba(255, 255, 255, 0.08)',
                  background: assignmentFilter === 'not_submitted' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  color: assignmentFilter === 'not_submitted' ? '#ef4444' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={16} />
                  <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>Not Submitted</span>
                </div>
                <span style={{ fontSize: '1.1rem', fontWeight: '800' }}>
                  {drawerData.filter(row => row.assignment_screenplay === 0 || row.assignment_shooting_script === 0).length}
                </span>
              </button>
            </div>
          )}

          {basePath === 'students/phase2-attendance' && (
            <div className="analytics-drawer-filter-group">
              <button
                onClick={() => setPhase2AttendanceFilter('shooting')}
                style={{
                  flex: 1,
                  padding: '0.8rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: phase2AttendanceFilter === 'shooting' ? '#10b981' : 'rgba(255, 255, 255, 0.08)',
                  background: phase2AttendanceFilter === 'shooting' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  color: phase2AttendanceFilter === 'shooting' ? '#10b981' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Film size={16} />
                  <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>Shooting</span>
                </div>
                <span style={{ fontSize: '1.1rem', fontWeight: '800' }}>
                  {drawerData.filter(row => row.phase2_shooting_attended === 1 || row.phase2_shooting_attended === true).length}
                </span>
              </button>

              <button
                onClick={() => setPhase2AttendanceFilter('editing')}
                style={{
                  flex: 1,
                  padding: '0.8rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: phase2AttendanceFilter === 'editing' ? '#fbbf24' : 'rgba(255, 255, 255, 0.08)',
                  background: phase2AttendanceFilter === 'editing' ? 'rgba(251, 191, 36, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  color: phase2AttendanceFilter === 'editing' ? '#fbbf24' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Film size={16} />
                  <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>Editing</span>
                </div>
                <span style={{ fontSize: '1.1rem', fontWeight: '800' }}>
                  {drawerData.filter(row => row.phase2_editing_attended === 1 || row.phase2_editing_attended === true).length}
                </span>
              </button>
            </div>
          )}

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
              Showing {displayDrawerData.length} {displayDrawerData.length === 1 ? 'student' : 'students'}
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
          ) : displayDrawerData.length === 0 ? (
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
                        <th key={field} className={getColClass(field)}>{label}</th>
                      ))}
                      <th className="student-table-col-progress">Course Progression</th>
                      <th className="student-table-col-actions" style={{ textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayDrawerData.map((row, index) => {
                      const s = students.find(student => student.id === row.user_id);
                      return (
                        <tr key={row.enrollment_id || row.user_id}>
                          <td>{index + 1}</td>
                          {statisticsDrawer.columns.map(([field]) => (
                            <td
                              key={field}
                              className={getColClass(field)}
                              style={field === 'name' ? { fontWeight: '500', color: 'var(--text-primary)' } : undefined}
                            >
                              {renderStatisticsCell(row, field)}
                            </td>
                          ))}
                          <td className="student-table-col-progress">
                            {renderCourseProgression(s)}
                          </td>
                          <td className="student-table-col-actions" style={{ textAlign: 'center' }}>
                            {renderStudentActions(s)}
                          </td>
                        </tr>
                      );
                    })}
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
                        <th className="student-table-col-id">Student ID</th>
                        <th className="student-table-col-name">Name</th>
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
                        <th className="student-table-col-batch">Batch</th>
                        <th>Last Login</th>
                        <th>Days Inactive</th>
                        <th className="student-table-col-progress">Course Progression</th>
                        <th className="student-table-col-actions" style={{ textAlign: 'center' }}>Actions</th>
                      </>
                    )}
                    {activeDrawer === 'failed-students' && (
                      <>
                        <th className="student-table-col-batch">Batch</th>
                        <th>Enrolled Course</th>
                        <th>Status</th>
                        <th className="student-table-col-progress">Course Progression</th>
                        <th className="student-table-col-actions" style={{ textAlign: 'center' }}>Actions</th>
                      </>
                    )}
                    {activeDrawer === 'missing-attendance' && (
                      <>
                        <th className="student-table-col-batch">Batch</th>
                        <th style={{ textAlign: 'center' }}>Shooting</th>
                        <th style={{ textAlign: 'center' }}>Editing</th>
                        <th className="student-table-col-progress">Course Progression</th>
                        <th className="student-table-col-actions" style={{ textAlign: 'center' }}>Actions</th>
                      </>
                    )}
                    {basePath === 'unpaid-students' && (
                      <>
                        <th className="student-table-col-batch">Batch</th>
                        <th>Phase 1 Fee</th>
                        <th>Phase 2 Fee</th>
                        <th>Total Due</th>
                        <th className="student-table-col-progress">Course Progression</th>
                        <th className="student-table-col-actions" style={{ textAlign: 'center' }}>Actions</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredDrawerData.map(row => {
                    const s = students.find(student => student.id === row.user_id);
                    return (
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
                            <td className="student-table-col-id">{row.student_id}</td>
                            <td className="student-table-col-name" style={{ fontWeight: '500', color: 'var(--text-primary)' }}>
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
                            <td className="student-table-col-batch">{row.batch_number || 'N/A'}</td>
                            <td>{row.last_login ? new Date(row.last_login).toLocaleDateString() : 'Never'}</td>
                            <td>
                              {row.last_login 
                                ? `${Math.floor((Date.now() - new Date(row.last_login).getTime()) / (1000 * 60 * 60 * 24))} days`
                                : 'Never logged in'
                              }
                            </td>
                            <td className="student-table-col-progress">
                              {renderCourseProgression(s)}
                            </td>
                            <td className="student-table-col-actions" style={{ textAlign: 'center' }}>
                              {renderStudentActions(s)}
                            </td>
                          </>
                        )}
                        {activeDrawer === 'failed-students' && (
                          <>
                            <td className="student-table-col-batch">{row.batch_number || 'N/A'}</td>
                            <td style={{ fontSize: '0.8rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.enrolled_courses}>
                              {row.enrolled_courses || 'None'}
                            </td>
                            <td><span style={{ color: '#ef4444' }}>Did Not Pass</span></td>
                            <td className="student-table-col-progress">
                              {renderCourseProgression(s)}
                            </td>
                            <td className="student-table-col-actions" style={{ textAlign: 'center' }}>
                              {renderStudentActions(s)}
                            </td>
                          </>
                        )}
                        {activeDrawer === 'missing-attendance' && (
                          <>
                            <td className="student-table-col-batch">{row.batch_number || 'N/A'}</td>
                            <td style={{ textAlign: 'center' }}>{row.phase2_shooting_attended ? '✅' : '❌'}</td>
                            <td style={{ textAlign: 'center' }}>{row.phase2_editing_attended ? '✅' : '❌'}</td>
                            <td className="student-table-col-progress">
                              {renderCourseProgression(s)}
                            </td>
                            <td className="student-table-col-actions" style={{ textAlign: 'center' }}>
                              {renderStudentActions(s)}
                            </td>
                          </>
                        )}
                        {basePath === 'unpaid-students' && (
                          <>
                            <td className="student-table-col-batch">{row.batch_number || 'N/A'}</td>
                            <td>{row.phase1_fee ? `${row.phase1_fee} ৳` : '0 ৳'}</td>
                            <td>{row.phase2_fee ? `${row.phase2_fee} ৳` : '0 ৳'}</td>
                            <td style={{ color: row.total_due > 0 ? '#f87171' : '#10b981', fontWeight: '600' }}>
                              {row.total_due ? `${row.total_due} ৳` : '0 ৳'}
                            </td>
                            <td className="student-table-col-progress">
                              {renderCourseProgression(s)}
                            </td>
                            <td className="student-table-col-actions" style={{ textAlign: 'center' }}>
                              {renderStudentActions(s)}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Student Manager Action Modals Portals ── */}
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
              <div className="modern-modal-grid-2col">
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>First Name</label>
                  <input type="text" name="firstName" value={editFormData.firstName} onChange={handleEditChange} className="input-glass" required />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Last Name</label>
                  <input type="text" name="lastName" value={editFormData.lastName} onChange={handleEditChange} className="input-glass" required />
                </div>
              </div>

              <div className="modern-modal-grid-2col">
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Email</label>
                  <input type="email" name="email" value={editFormData.email} onChange={handleEditChange} className="input-glass" required style={{ paddingLeft: '1rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Mobile Number</label>
                  <input type="text" name="mobileNumber" value={editFormData.mobileNumber} onChange={handleEditChange} className="input-glass" placeholder="+880..." style={{ paddingLeft: '1rem' }} />
                </div>
              </div>

              <div className="modern-modal-grid-2col">
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Username</label>
                  <input type="text" name="username" value={editFormData.username} onChange={handleEditChange} className="input-glass" required style={{ paddingLeft: '1rem' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Batch Number</label>
                  <input type="text" name="batchNumber" value={editFormData.batchNumber} onChange={handleEditChange} className="input-glass" style={{ paddingLeft: '1rem' }} />
                </div>
              </div>

              <div className="modern-modal-grid-2col">
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

              {/* Dynamic Course Fee Section */}
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

              {(editError || validateFees()) && (
                <div className="error-alert" style={{ marginTop: '0.5rem', color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  ⚠️ {editError || validateFees()}
                </div>
              )}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setEditingStudent(null)} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>Cancel</button>
              <button 
                type="submit" 
                className="modern-btn modern-btn--primary" 
                disabled={isEditing || !!validateFees()} 
                style={{ 
                  flex: 1,
                  opacity: (isEditing || !!validateFees()) ? 0.5 : 1,
                  cursor: (isEditing || !!validateFees()) ? 'not-allowed' : 'pointer'
                }}
              >
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
                  {academicStudent.full_name || `${academicStudent.first_name || ''} ${academicStudent.last_name || ''}`} <span style={{ opacity: 0.7 }}>({academicStudent.batch_number ? `${getOrdinalSuffix(academicStudent.batch_number)} Batch` : 'No Batch'})</span>
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
                      <div className="modern-modal-grid-2col">
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

              {(academicError || getAcademicValidationError()) && (
                <div className="error-alert" style={{ 
                  marginTop: '0.75rem', 
                  color: '#f87171', 
                  background: 'rgba(239, 68, 68, 0.1)', 
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem'
                }}>
                  ⚠️ {academicError || getAcademicValidationError()}
                </div>
              )}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={closeAcademicModal} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>Cancel</button>
              <button 
                type="submit" 
                className="modern-btn modern-btn--primary" 
                disabled={isAcademicSaving || !!getAcademicValidationError()} 
                style={{ 
                  flex: 1, 
                  background: '#10b981', 
                  borderColor: '#10b981',
                  opacity: (isAcademicSaving || !!getAcademicValidationError()) ? 0.5 : 1,
                  cursor: (isAcademicSaving || !!getAcademicValidationError()) ? 'not-allowed' : 'pointer'
                }}
              >
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
                  {phase2Student.full_name || `${phase2Student.first_name || ''} ${phase2Student.last_name || ''}`} <span style={{ opacity: 0.7 }}>({phase2Student.batch_number ? `${getOrdinalSuffix(phase2Student.batch_number)} Batch` : 'No Batch'})</span>
                </p>
                <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: '500', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.2)', padding: '0.2rem 0.6rem', borderRadius: '6px', display: 'inline-block' }}>
                  Online Filmmaking Course
                </p>
              </div>
              <button type="button" className="icon-btn-ghost" onClick={closePhase2Modal} aria-label="Close"><X size={20} /></button>
            </div>

            <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                Mark the parts the student has participated in. Step 4 (Phase 2: Completed Course) will be automatically checked once <strong>both</strong> Shooting and Editing are attended.
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
