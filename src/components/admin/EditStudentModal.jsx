import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Edit, X, Lock } from 'lucide-react';

// Helper function to dynamically sync installments and payment status based on fees
const syncInstallmentsAndStatus = (target, forceAutoAdjust = false) => {
  if (!target) return;
  const fullFeeNum    = parseFloat(String(target.full_fee    || '').replace(/[^\d.]/g, '')) || 0;
  const amountPaidNum = parseFloat(String(target.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
  const discountNum   = parseFloat(String(target.discount    || '').replace(/[^\d.]/g, '')) || 0;
  const remainingDue  = Math.max(0, fullFeeNum - discountNum - amountPaidNum);

  // ── SMART ZERO-PAYMENT DETECTION ─────────────────────────────────────────
  // If amount_paid is 0 AND no discount, reset all installment statuses to
  // Pending and redistribute amounts evenly to sum to the full fee.
  const effectivePayment = amountPaidNum + discountNum;
  if (effectivePayment === 0 && (target.installments || []).length > 0) {
    const count = target.installments.length;
    if (forceAutoAdjust && fullFeeNum > 0 && count > 0) {
      // Redistribute amounts evenly (remainder goes into first installment)
      const baseAmount = Math.floor(fullFeeNum / count);
      const remainder  = fullFeeNum - baseAmount * count;
      target.installments = target.installments.map((inst, i) => ({
        ...inst,
        amount: String(i === 0 ? baseAmount + remainder : baseAmount),
        status: 'Pending'
      }));
    } else {
      // Just reset statuses, keep amounts
      target.installments = target.installments.map(inst => ({
        ...inst,
        status: 'Pending'
      }));
    }
    // Payment status → Due (no money received at all)
    if (fullFeeNum > 0) target.status = 'Due';
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────


  // 1. Auto-detect payment status
  if (fullFeeNum > 0) {
    if (amountPaidNum + discountNum >= fullFeeNum) {
      target.status = 'Paid Full';
    } else if (amountPaidNum > 0 || discountNum > 0) {
      target.status = 'Partial';
    } else {
      if (target.status === 'Paid Full' || target.status === 'Partial' || !target.status) {
        target.status = 'Due';
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
    } else if (forceAutoAdjust) {
      const updatedInst = [];
      let runningSum = 0;
      for (let i = 0; i < currentInst.length; i++) {
        const inst = currentInst[i];
        const amountVal = parseFloat(String(inst.amount || '').replace(/[^\d.]/g, '')) || 0;
        
        if (runningSum >= remainingDue) {
          break;
        }
        
        if (runningSum + amountVal >= remainingDue) {
          const leftover = remainingDue - runningSum;
          updatedInst.push({ ...inst, amount: String(leftover) });
          runningSum = remainingDue;
          break;
        } else {
          updatedInst.push({ ...inst, amount: String(amountVal) });
          runningSum += amountVal;
        }
      }
      
      if (runningSum < remainingDue) {
        const leftover = remainingDue - runningSum;
        updatedInst.push({ amount: String(leftover), dueDate: '', status: 'Pending' });
      }
      target.installments = updatedInst;
    }
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
  onAddInstallment,
  onInstallmentChange,
  disabled: initialDisabled = false,
  lockMessage = null,
  onUnlockClick = null,
  isOverridden = false,
  batchFeeValue = null
}) {
  const disabled = initialDisabled && !isOverridden;
  const key = phaseKey ? `${phaseKey}.` : '';
  const courseFees = feeData?.[courseName] || {};
  const data = phaseKey ? (courseFees[phaseKey] || {}) : courseFees;

  const fullFeeNum = parseFloat(String(data.full_fee || '').replace(/[^\d.]/g, '')) || 0;
  const amountPaidNum = parseFloat(String(data.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
  const discountNum = parseFloat(String(data.discount || '').replace(/[^\d.]/g, '')) || 0;
  const rawRemainingDue = Math.max(0, fullFeeNum - discountNum - amountPaidNum);

  const installments = data.installments || [];
  const remainingDue = installments.length > 0
    ? installments.filter(inst => (inst.status || '').toLowerCase() !== 'paid').reduce((sum, inst) => sum + (parseFloat(String(inst.amount || '').replace(/[^\d.]/g, '')) || 0), 0)
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
      {isOverridden && (
        <div style={{
          fontSize: '0.75rem',
          color: '#34d399',
          background: 'rgba(52, 211, 153, 0.05)',
          border: '1px solid rgba(52, 211, 153, 0.2)',
          padding: '0.4rem 0.65rem',
          borderRadius: '6px',
          marginBottom: '0.6rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontWeight: '500'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>🔓</span> Force Unlocked (Bypassed Lock)
          </div>
          {onUnlockClick && (
            <button
              type="button"
              onClick={onUnlockClick}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: 'none',
                color: '#f87171',
                cursor: 'pointer',
                fontSize: '0.68rem',
                fontWeight: '600',
                padding: '0.15rem 0.45rem',
                borderRadius: '4px'
              }}
            >
              Reset Lock
            </button>
          )}
        </div>
      )}
      {initialDisabled && !isOverridden && (
        <div style={{
          fontSize: '0.75rem',
          color: '#fbbf24',
          background: 'rgba(245, 158, 11, 0.05)',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          padding: '0.4rem 0.65rem',
          borderRadius: '6px',
          marginBottom: '0.6rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontWeight: '500'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>⚠️</span> {lockMessage || 'Locked'}
          </div>
          {onUnlockClick && (
            <button
              type="button"
              onClick={onUnlockClick}
              style={{
                background: 'rgba(99, 102, 241, 0.15)',
                border: 'none',
                color: '#818cf8',
                cursor: 'pointer',
                fontSize: '0.68rem',
                fontWeight: '600',
                padding: '0.15rem 0.45rem',
                borderRadius: '4px'
              }}
            >
              Unlock & Edit
            </button>
          )}
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
          {batchFeeValue !== null ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: '8px',
              padding: '0.5rem 0.65rem',
              fontSize: '0.875rem',
              color: 'var(--text-primary)',
              fontWeight: 600,
            }}>
              <Lock size={13} style={{ color: '#818cf8', flexShrink: 0 }} />
              <span>{batchFeeValue > 0 ? `৳${Number(batchFeeValue).toLocaleString('en-BD')}` : '—'}</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#818cf8', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                Batch Fee Manager
              </span>
            </div>
          ) : (
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
          )}
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

      {/* Installment Section */}
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
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAddInstallment(courseName, phaseKey)}
              style={{
                background: disabled ? 'rgba(255,255,255,0.05)' : 'rgba(99, 102, 241, 0.15)',
                border: 'none',
                color: disabled ? 'var(--text-muted)' : '#818cf8',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: '0.72rem',
                fontWeight: 600,
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                opacity: disabled ? 0.5 : 1
              }}
            >
              + Add Installment
            </button>
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

const getInitialFormData = (student) => {
  if (!student) {
    return {
      firstName: '', lastName: '', email: '', username: '', batchNumber: '', mobileNumber: '',
      phase1_fee: '', phase2_fee: '',
      course_fees: {},
      discount: '',
      courses: [],
      snNo: '',
      year: new Date().getFullYear().toString()
    };
  }

  const names = student.full_name ? student.full_name.split(' ') : ['', ''];
  const first = student.first_name || names[0] || '';
  const last = student.last_name || names.slice(1).join(' ') || '';
  
  let extractedSn = '';
  let extractedYear = new Date().getFullYear().toString();
  if (student.student_id && student.student_id.startsWith('BFI')) {
    const id = student.student_id;
    if (id.includes('-')) {
      const parts = id.split('-');
      if (parts.length >= 3) {
        extractedSn = parts[2];
      } else if (parts.length === 2) {
        extractedSn = parts[1];
      }
    } else {
      if (id.length >= 9) {
        extractedSn = id.substring(3, 5);
        extractedYear = id.substring(id.length - 4);
      }
    }
  }

  const builtFees = {};
  const enrollments = student.enrollments || [];
  
  if (enrollments.length === 0 && student.course_name) {
    enrollments.push({
      course_name: student.course_name,
      fee_details: null
    });
  }

  enrollments.forEach(enr => {
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

  return {
    firstName: first,
    lastName: last,
    email: student.email || '',
    mobileNumber: student.mobile_number || '',
    username: student.username || '',
    batchNumber: student.batch_number || '',
    snNo: extractedSn,
    year: extractedYear,
    additionalInfo: student.additional_info || '',
    phase1_fee: student.phase1_fee || '',
    phase2_fee: student.phase2_fee || '',
    course_fees: builtFees,
    discount: student.discount || '',
    courses: student.enrollments ? student.enrollments.map(e => e.course_name) : (student.course_name ? [student.course_name] : []),
  };
};

export default function EditStudentModal({ student, onClose, onSaveSuccess }) {
  const needsFetch = !student || !student.email || !student.enrollments;
  const [loading, setLoading] = useState(needsFetch);
  const [fullStudent, setFullStudent] = useState(student && student.email && student.enrollments ? student : null);
  const [editFormData, setEditFormData] = useState(() => getInitialFormData(student));
  const [isEditing, setIsEditing] = useState(false);
  const [overridePhase2Lock, setOverridePhase2Lock] = useState(false);
  const [overridePhase1Lock, setOverridePhase1Lock] = useState(false);
  const [editError, setEditError] = useState('');
  const batchFeesRef = useRef({});

  const availableCourses = [
    { name: 'Online Filmmaking Course', type: 'filmmaking' },
    { name: 'Film Appreciation Course', type: 'workshop' },
    { name: 'Script Writing', type: 'workshop' },
    { name: 'Cinematography', type: 'workshop' },
    { name: 'Acting', type: 'workshop' }
  ];

  // Fetch full student details and setup form state if needed, and fetch batch fees
  useEffect(() => {
    if (!student) return;

    let isMounted = true;

    const initialize = async () => {
      setEditError('');
      setOverridePhase1Lock(false);
      setOverridePhase2Lock(false);

      let targetStudent = student;
      const studentId = student.id || student.user_id;

      // If student is incomplete (lacks email or enrollments), fetch details
      if (needsFetch) {
        setLoading(true);
        try {
          const res = await fetch(`/api/admin/students/${studentId}?t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.student) {
              targetStudent = data.student;
            } else {
              throw new Error('Student data not found in response');
            }
          } else {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Failed to fetch student details (Status ${res.status})`);
          }
        } catch (err) {
          console.error('Error fetching student details:', err);
          setEditError(`Failed to load student details: ${err.message}`);
        }
      }

      if (!isMounted) return;

      setFullStudent(targetStudent);
      const parsedFormData = getInitialFormData(targetStudent);

      // Fetch batch fees from Batch Fee Manager for this student's batch
      const batchNum = targetStudent.batch_number;
      let fetchedBatchFees = {};
      try {
        const token = localStorage.getItem('token');
        const bfRes = await fetch('/api/admin/batch-fees', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (bfRes.ok) {
          const allBatchFees = await bfRes.json();
          if (batchNum) {
            // First pass: collect default fees
            allBatchFees.forEach(bf => {
              if (String(bf.batch_number).trim().toUpperCase() === 'DEFAULT') {
                fetchedBatchFees[bf.course_name] = bf;
              }
            });
            // Second pass: override with batch-specific fees if they exist
            allBatchFees.forEach(bf => {
              if (String(bf.batch_number).trim() === String(batchNum).trim()) {
                fetchedBatchFees[bf.course_name] = bf;
              }
            });
          } else {
             // If student has no batch number, just use defaults
             allBatchFees.forEach(bf => {
               if (String(bf.batch_number).trim().toUpperCase() === 'DEFAULT') {
                 fetchedBatchFees[bf.course_name] = bf;
               }
             });
          }
        }
      } catch (e) {
        console.warn('Could not fetch batch fees:', e);
      }
      batchFeesRef.current = fetchedBatchFees;

      // Apply batch fee defaults
      const builtFees = parsedFormData.course_fees;
      (targetStudent.enrollments || []).forEach(enr => {
        const cn = enr.course_name;
        const bf = fetchedBatchFees[cn];
        if (!bf) return;
        if (cn === 'Online Filmmaking Course') {
          if (!builtFees[cn].phase1.full_fee && bf.phase1_fee) {
            builtFees[cn].phase1.full_fee = String(bf.phase1_fee);
            syncInstallmentsAndStatus(builtFees[cn].phase1);
          }
          // Only apply Phase 2 batch fee default if Phase 1 exam is passed
          // (i.e., step2_completed === 1), otherwise it causes a phantom
          // "Phase 2 modified" error on the backend even though the user
          // never touched Phase 2 — the batch fee injection would differ
          // from the empty string stored in the database.
          const phase2Unlocked = enr.step2_completed === 1;
          if (phase2Unlocked && !builtFees[cn].phase2.full_fee && bf.phase2_fee) {
            builtFees[cn].phase2.full_fee = String(bf.phase2_fee);
            syncInstallmentsAndStatus(builtFees[cn].phase2);
          }
        } else {
          if (!builtFees[cn].full_fee && bf.full_fee) {
            builtFees[cn].full_fee = String(bf.full_fee);
            syncInstallmentsAndStatus(builtFees[cn]);
          }
        }
      });

      setEditFormData(parsedFormData);
      setLoading(false);
    };

    initialize();

    return () => {
      isMounted = false;
    };
  }, [student]);

  const handleEditChange = (e) => setEditFormData({ ...editFormData, [e.target.name]: e.target.value });

  const handleEditCourseChange = (courseName) => {
    const currentCourses = editFormData.courses || [];
    const isRemoving = currentCourses.includes(courseName);
    const newCourses = isRemoving
      ? currentCourses.filter(c => c !== courseName)
      : [...currentCourses, courseName];

    let newFees = { ...editFormData.course_fees };
    const bfMap = batchFeesRef.current || {};
    if (!isRemoving && !newFees[courseName]) {
      // Build default empty fees
      if (courseName === 'Online Filmmaking Course') {
        newFees[courseName] = {
          phase1: { full_fee: '', amount_paid: '', status: '', discount: '', installments: [] },
          phase2: { full_fee: '', amount_paid: '', status: '', discount: '', installments: [] }
        };
        const bf = bfMap[courseName];
        if (bf) {
          if (bf.phase1_fee) { newFees[courseName].phase1.full_fee = String(bf.phase1_fee); }
          if (bf.phase2_fee) { newFees[courseName].phase2.full_fee = String(bf.phase2_fee); }
        }
        syncInstallmentsAndStatus(newFees[courseName].phase1);
        syncInstallmentsAndStatus(newFees[courseName].phase2);
      } else {
        newFees[courseName] = { full_fee: '', amount_paid: '', status: '', discount: '', installments: [] };
        const bf = bfMap[courseName];
        if (bf && bf.full_fee) { newFees[courseName].full_fee = String(bf.full_fee); }
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
        syncInstallmentsAndStatus(fees[courseName][phase], true);
      } else {
        fees[courseName] = { ...fees[courseName], [field]: value };
        syncInstallmentsAndStatus(fees[courseName], true);
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

  const handleAddInstallment = (courseName, phaseKey) => {
    setEditFormData(prev => {
      const fees = { ...prev.course_fees };
      const target = phaseKey ? fees[courseName]?.[phaseKey] : fees[courseName];
      if (target) {
        const currentInst = target.installments || [];
        target.installments = [
          ...currentInst,
          { amount: '', dueDate: '', status: 'Pending' }
        ];
        syncInstallmentsAndStatus(target, false);
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
        const fullFee = parseFloat(String(data.full_fee || '').replace(/[^\d.]/g, '')) || 0;
        const amountPaid = parseFloat(String(data.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
        const discount = parseFloat(String(data.discount || '').replace(/[^\d.]/g, '')) || 0;
        
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
    setIsEditing(true);

    try {
      // Custom validation for required fields
      if (!editFormData.firstName?.trim()) {
        throw new Error('First Name is required.');
      }
      if (!editFormData.lastName?.trim()) {
        throw new Error('Last Name is required.');
      }
      if (!editFormData.email?.trim()) {
        throw new Error('Email is required.');
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(editFormData.email.trim())) {
        throw new Error('Please enter a valid email address.');
      }
      if (!editFormData.username?.trim()) {
        throw new Error('Username is required.');
      }

      const valError = validateFees();
      if (valError) {
        throw new Error(valError);
      }

      const studentId = student.id || student.user_id;
      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(editFormData)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update student profile');

      // ── Auto-sync step1_completed based on payment amount ────────
      // Rule: any payment made (> 0) → checked/admitted; payment amount zero → unchecked/not admitted.
      const studentIdForProgress = student.id || student.user_id;
      const enrollmentsToCheck = fullStudent?.enrollments || student?.enrollments || [];

      const syncPromises = enrollmentsToCheck.map(async (enr) => {
        const cn = enr.course_name;
        const courseFees = editFormData.course_fees?.[cn];
        if (!courseFees) return;

        let effectiveAmountPaid = 0;

        if (cn === 'Online Filmmaking Course') {
          const ph1 = courseFees.phase1 || {};
          const installments = ph1.installments || [];
          if (installments.length > 0) {
            // Sum all installments that are "Paid"
            effectiveAmountPaid = installments
              .filter(inst => (inst.status || '').toLowerCase() === 'paid')
              .reduce((sum, inst) => sum + (parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) || 0), 0);
          } else {
            effectiveAmountPaid = parseFloat((ph1.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
          }
        } else {
          const installments = courseFees.installments || [];
          if (installments.length > 0) {
            effectiveAmountPaid = installments
              .filter(inst => (inst.status || '').toLowerCase() === 'paid')
              .reduce((sum, inst) => sum + (parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) || 0), 0);
          } else {
            effectiveAmountPaid = parseFloat((courseFees.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
          }
        }

        const targetStep1Val = effectiveAmountPaid > 0 ? 1 : 0;

        if (enr.step1_completed !== targetStep1Val) {
          try {
            await fetch(`/api/admin/students/${studentIdForProgress}/progress`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
              },
              body: JSON.stringify({ course_id: enr.id, step1_completed: targetStep1Val })
            });
          } catch (progErr) {
            console.warn('Could not sync step1_completed for enrollment', enr.id, progErr);
          }
        }
      });

      await Promise.all(syncPromises);
      // ─────────────────────────────────────────────────────────────

      onSaveSuccess();
      onClose();

    } catch (err) {
      setEditError(err.message);
    } finally {
      setIsEditing(false);
    }
  };

  if (!student) return null;

  return createPortal(
    <div className="modern-modal-overlay" onClick={onClose}>
      <div className="modern-modal-content glass-panel shadow-2xl" style={{ width: '100%', maxWidth: '500px', margin: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submitEdit} noValidate style={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'hidden' }}>
          <div className="modern-modal-header">
            <h3 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Edit className="text-accent" /> Edit Student Details
            </h3>
            <button type="button" className="icon-btn-ghost" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
          
          <div className="modern-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '60vh', minHeight: '300px', overflowY: 'auto', position: 'relative' }}>
            {loading && (
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(15, 23, 42, 0.75)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                borderRadius: '12px'
              }}>
                <div className="loader-spinner" style={{ width: '32px', height: '32px', borderWidth: '3px' }} />
                <div style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Loading student details...</div>
              </div>
            )}
            
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

            <div style={{ marginTop: '0.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>Additional Info (Legacy Data)</label>
              <textarea name="additionalInfo" value={editFormData.additionalInfo} onChange={handleEditChange} className="input-glass" rows="4" style={{ padding: '0.75rem 1rem', resize: 'vertical' }} placeholder="Any extra information extracted from old documents..."></textarea>
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
                    
                    let isPhase1Paid = true;
                    let isPhase2PaidOrPartial = false;
                    let phase1LockMessage = '';
                    let phase2LockMessage = '';
                    
                    if (isOFC) {
                      const phase1Data = editFormData.course_fees?.[courseName]?.phase1 || {};
                      const phase1PaidAmount = parseFloat(String(phase1Data.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
                      const phase1Discount = parseFloat(String(phase1Data.discount || '').replace(/[^\d.]/g, '')) || 0;
                      const phase1FullFee = parseFloat(String(phase1Data.full_fee || '').replace(/[^\d.]/g, '')) || 0;
                      const phase1Status = (phase1Data.status || '').toLowerCase();
                      
                      isPhase1Paid = phase1FullFee > 0 
                        ? (phase1PaidAmount + phase1Discount >= phase1FullFee || phase1Status === 'paid full' || phase1Status === 'paid' || phase1Status === 'waived')
                        : true;

                      const phase2Data = editFormData.course_fees?.[courseName]?.phase2 || {};
                      const phase2PaidAmount = parseFloat(String(phase2Data.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
                      const phase2Status = (phase2Data.status || '').toLowerCase();
                      
                      isPhase2PaidOrPartial = phase2PaidAmount > 0 || phase2Status === 'paid full' || phase2Status === 'partial' || phase2Status === 'paid';
                      
                      if (isPhase2PaidOrPartial) {
                        phase1LockMessage = 'Locked: Phase 2 has payments';
                      }
                      
                      const ofcEnr = fullStudent?.enrollments?.find(e => e.course_name === 'Online Filmmaking Course');
                      const isPhase1Passed = ofcEnr ? ofcEnr.step2_completed === 1 : false;
                      
                      if (!isPhase1Passed && !isPhase1Paid) {
                        phase2LockMessage = 'Locked: Phase 1 exam passed & Phase 1 payment fully paid required';
                      } else if (!isPhase1Passed) {
                        phase2LockMessage = 'Locked: Phase 1 exam passed required';
                      } else if (!isPhase1Paid) {
                        phase2LockMessage = 'Locked: Phase 1 payment fully paid required';
                      }
                    }

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
                              onAddInstallment={handleAddInstallment}
                              onInstallmentChange={handleInstallmentChange}
                              disabled={isPhase2PaidOrPartial}
                              lockMessage={phase1LockMessage}
                              onUnlockClick={() => setOverridePhase1Lock(prev => !prev)}
                              isOverridden={overridePhase1Lock}
                              batchFeeValue={(() => { const r = batchFeesRef.current[courseName]; return (r && r.phase1_fee > 0) ? r.phase1_fee : null; })()}
                            />
                            {(() => {
                              const ofcEnr = fullStudent?.enrollments?.find(e => e.course_name === 'Online Filmmaking Course');
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
                                  onAddInstallment={handleAddInstallment}
                                  onInstallmentChange={handleInstallmentChange}
                                  disabled={!isPhase1Passed || !isPhase1Paid}
                                  lockMessage={phase2LockMessage}
                                  onUnlockClick={() => setOverridePhase2Lock(prev => !prev)}
                                  isOverridden={overridePhase2Lock}
                                  batchFeeValue={(() => { const r = batchFeesRef.current[courseName]; return (r && r.phase2_fee > 0) ? r.phase2_fee : null; })()}
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
                            onAddInstallment={handleAddInstallment}
                            onInstallmentChange={handleInstallmentChange}
                            batchFeeValue={(() => { const r = batchFeesRef.current[courseName]; return (r && r.full_fee > 0) ? r.full_fee : null; })()}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>

          {/* Error banner lives OUTSIDE the scrollable body so it's always visible */}
          {(editError || validateFees()) && (
            <div style={{
              margin: '0 1.25rem',
              padding: '0.65rem 1rem',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              borderRadius: '8px',
              color: '#f87171',
              fontSize: '0.82rem',
              fontWeight: '600',
              lineHeight: '1.4',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              marginBottom: '0.5rem'
            }}>
              <span style={{ flexShrink: 0 }}>⚠️</span>
              <span>{editError || validateFees()}</span>
            </div>
          )}

          <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
            <button type="button" onClick={onClose} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>Cancel</button>
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
      </div>
    </div>,
    document.body
  );
}
