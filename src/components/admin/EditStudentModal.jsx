import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Edit, X, Lock } from 'lucide-react';
import { resolveClientDiscount, resolveFeeAccounting } from '../../utils/feeUtils';

// Helper function to dynamically sync installments and payment status based on fees without mutating installments
const syncInstallmentsAndStatus = (target) => {
  if (!target) return;
  const acct = resolveFeeAccounting(target);
  // Set authoritative status based on financial evidence
  if (target.status !== 'Waived') {
    target.status = acct.status;
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

  const acct = resolveFeeAccounting(data, {
    grossFeeOverride: batchFeeValue
  });
  const fullFeeNum = acct.grossFee;
  const amountPaidNum = acct.amountPaid;
  const discountNum = acct.discount;
  const netPayable = acct.netPayable;
  const cashCollected = acct.cashCollected;
  const remainingDue = acct.remainingDue;
  const overpayment = acct.overpayment;
  const isFullyCompleted = acct.isPaid;

  const installments = data.installments || [];

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
            <span>🔓</span> Force Unlocked: Lock Overridden by Admin (Authorized)
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
      {(label || (fullFeeNum > 0 && isFullyCompleted)) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          {label ? (
            <p style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {disabled && <span>🔒</span>} {label}
            </p>
          ) : <div />}
          {fullFeeNum > 0 && isFullyCompleted && (
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
              borderColor: overpayment > 0 ? '#34d399' : 'rgba(255,255,255,0.1)',
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

      {/* Financial Reconciliation Summary */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
        gap: '0.4rem',
        padding: '0.5rem 0.65rem',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '6px',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        marginBottom: '0.6rem',
        fontSize: '0.75rem'
      }}>
        <div>
          <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.68rem' }}>Gross Fee</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>৳{fullFeeNum.toLocaleString()}</span>
        </div>
        {discountNum > 0 && (
          <div>
            <span style={{ color: '#10b981', display: 'block', fontSize: '0.68rem' }}>Discount</span>
            <span style={{ fontWeight: 600, color: '#10b981' }}>-৳{discountNum.toLocaleString()}</span>
          </div>
        )}
        <div>
          <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '0.68rem' }}>Net Payable</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>৳{netPayable.toLocaleString()}</span>
        </div>
        <div>
          <span style={{ color: '#34d399', display: 'block', fontSize: '0.68rem' }}>Cash Collected</span>
          <span style={{ fontWeight: 600, color: '#34d399' }}>৳{cashCollected.toLocaleString()}</span>
        </div>
        <div>
          <span style={{ color: remainingDue > 0 ? '#fbbf24' : '#34d399', display: 'block', fontSize: '0.68rem' }}>Remaining Due</span>
          <span style={{ fontWeight: 700, color: remainingDue > 0 ? '#fbbf24' : '#34d399' }}>
            {remainingDue > 0 ? `৳${remainingDue.toLocaleString()}` : '৳0'}
          </span>
        </div>
        {overpayment > 0 && (
          <div>
            <span style={{ color: '#60a5fa', display: 'block', fontSize: '0.68rem' }}>Overpayment</span>
            <span style={{ fontWeight: 700, color: '#60a5fa' }}>+৳{overpayment.toLocaleString()}</span>
          </div>
        )}
      </div>

      {overpayment > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.4rem 0.65rem',
          background: 'rgba(96, 165, 250, 0.08)',
          border: '1px solid rgba(96, 165, 250, 0.25)',
          borderRadius: '6px',
          color: '#93c5fd',
          fontSize: '0.75rem',
          marginBottom: '0.6rem'
        }}>
          <span>✨</span>
          <span>
            <strong>Surplus Payment:</strong> ৳{overpayment.toLocaleString()} will be credited / recorded as overpayment.
          </span>
        </div>
      )}

      {/* Installment Section */}
      {(remainingDue > 0 || installments.length > 0) && (
        <div style={{ 
          marginTop: '0.75rem', 
          padding: '0.75rem', 
          background: 'rgba(245, 158, 11, 0.02)', 
          borderRadius: '8px', 
          border: '1px dashed rgba(245, 158, 11, 0.3)' 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <span style={{ fontSize: '0.78rem', color: overpayment > 0 ? '#34d399' : '#fbbf24', fontWeight: 600 }}>
              📅 Installment Details {overpayment > 0 ? `(Overpaid: ৳${overpayment.toLocaleString()})` : `(Due: ৳${remainingDue.toLocaleString()})`}
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

const getInitialFormData = (student, explicitBatchId) => {
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
    const isMultiPhase = cn === 'Online Filmmaking Course' || (enr.course_definition_id && (enr.defined_progress?.phaseCount > 1 || enrFeeDetails?.phase2 || (Array.isArray(enrFeeDetails?.phases) && enrFeeDetails.phases.length > 1)));
    const phaseCount = isMultiPhase ? (cn === 'Online Filmmaking Course' ? 2 : (enr.defined_progress?.phaseCount || (Array.isArray(enrFeeDetails?.phases) ? enrFeeDetails.phases.length : (enrFeeDetails?.phase2 ? 2 : 1)))) : 1;

    if (isMultiPhase && phaseCount > 1) {
      builtFees[cn] = {
        enrollment_id: enr.id,
        batch_id: enr.batch_id
      };
      for (let p = 1; p <= phaseCount; p++) {
        const pKey = `phase${p}`;
        const pData = enrFeeDetails?.[pKey] || (Array.isArray(enrFeeDetails?.phases) ? enrFeeDetails.phases[p - 1] : (p === 1 ? enrFeeDetails : null)) || {};
        builtFees[cn][pKey] = {
          full_fee:    pData.full_fee !== undefined ? String(pData.full_fee) : '',
          amount_paid: pData.amount_paid !== undefined ? String(pData.amount_paid) : '',
          status:      pData.status || '',
          discount:    pData.discount !== undefined ? String(pData.discount) : (p === 1 && enrFeeDetails?.discount ? String(enrFeeDetails.discount) : ''),
          discount_amount: pData.discount_amount !== undefined ? pData.discount_amount : (p === 1 ? enrFeeDetails?.discount_amount : undefined),
          direct_payment: pData.direct_payment,
          down_payment: pData.down_payment,
          installments: Array.isArray(pData.installments) ? pData.installments : []
        };
        syncInstallmentsAndStatus(builtFees[cn][pKey]);
      }
    } else {
      builtFees[cn] = {
        enrollment_id: enr.id,
        batch_id: enr.batch_id,
        full_fee:    enrFeeDetails?.full_fee !== undefined ? String(enrFeeDetails.full_fee) : '',
        amount_paid: enrFeeDetails?.amount_paid !== undefined ? String(enrFeeDetails.amount_paid) : '',
        status:      enrFeeDetails?.status || '',
        discount:    enrFeeDetails?.discount !== undefined ? String(enrFeeDetails.discount) : '',
        discount_amount: enrFeeDetails?.discount_amount,
        direct_payment: enrFeeDetails?.direct_payment,
        down_payment: enrFeeDetails?.down_payment,
        installments: Array.isArray(enrFeeDetails?.installments) ? enrFeeDetails.installments : []
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
    batch_id: explicitBatchId || student.batch_id || student.batchId || null,
    enrollment_id: student.enrollment_id || student.enrollmentId || null,
  };
};

export default function EditStudentModal({ student, batchId, onClose, onSaveSuccess }) {
  const needsFetch = !student || !student.email || !student.enrollments;
  const [loading, setLoading] = useState(needsFetch);
  const [fullStudent, setFullStudent] = useState(student && student.email && student.enrollments ? student : null);
  const [editFormData, setEditFormData] = useState(() => getInitialFormData(student, batchId));
  const [isEditing, setIsEditing] = useState(false);
  const [phaseLockOverrides, setPhaseLockOverrides] = useState({});
  const [editError, setEditError] = useState('');
  const batchFeesRef = useRef({});

  const togglePhaseLock = (courseName, phaseKey) => {
    setPhaseLockOverrides(prev => ({
      ...prev,
      [`${courseName}:${phaseKey}`]: !prev[`${courseName}:${phaseKey}`]
    }));
  };

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
      setPhaseLockOverrides({});

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
      const courseEnr = fullStudent?.enrollments?.find(e => e.course_name === courseName);
      const isOFC = courseName === 'Online Filmmaking Course';
      const isMultiPhase = isOFC || (courseEnr?.course_definition_id && (courseEnr?.defined_progress?.phaseCount > 1));
      const phaseCount = isOFC ? 2 : (courseEnr?.defined_progress?.phaseCount || 1);

      if (isMultiPhase && phaseCount > 1) {
        newFees[courseName] = {
          enrollment_id: courseEnr?.id,
          batch_id: courseEnr?.batch_id
        };
        const bf = bfMap[courseName];
        for (let p = 1; p <= phaseCount; p++) {
          const pKey = `phase${p}`;
          newFees[courseName][pKey] = { full_fee: '', amount_paid: '', status: '', discount: '', installments: [] };
          if (bf) {
            const pFee = p === 1 ? bf.phase1_fee : (p === 2 ? bf.phase2_fee : null);
            if (pFee) { newFees[courseName][pKey].full_fee = String(pFee); }
          }
          syncInstallmentsAndStatus(newFees[courseName][pKey]);
        }
      } else {
        newFees[courseName] = { 
          enrollment_id: courseEnr?.id,
          batch_id: courseEnr?.batch_id,
          full_fee: '', 
          amount_paid: '', 
          status: '', 
          discount: '', 
          installments: [] 
        };
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
        const batchFeeValue = (() => {
          const r = batchFeesRef.current[courseName];
          if (!r) return null;
          if (phaseKey) return r[`${phaseKey}_fee`] || null;
          return r.full_fee || null;
        })();
        const acct = resolveFeeAccounting(target, { grossFeeOverride: batchFeeValue });
        const suggestedAmount = acct.remainingDue > 0 ? String(acct.remainingDue) : '';
        target.installments = [
          ...currentInst,
          { amount: suggestedAmount, dueDate: '', status: 'Pending' }
        ];
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
        const fullFee = parseFloat(String(data.full_fee || '').replace(/[^\d.]/g, '')) || 0;
        const amountPaid = parseFloat(String(data.amount_paid || '').replace(/[^\d.]/g, '')) || 0;
        const discount = resolveClientDiscount(data.discount, fullFee, data.discount_amount);
        
        if (fullFee < 0) {
          return `${label}: Course fee cannot be negative.`;
        }
        if (amountPaid < 0) {
          return `${label}: Amount paid cannot be negative.`;
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

      const courseEnr = fullStudent?.enrollments?.find(e => e.course_name === courseName);
      const isMultiPhase = isOFC || (courseEnr?.course_definition_id && (courseEnr?.defined_progress?.phaseCount > 1 || feeData?.phase2));
      const phaseCount = isOFC ? 2 : (courseEnr?.defined_progress?.phaseCount || (feeData?.phase2 ? 2 : 1));

      if (isMultiPhase && phaseCount > 1) {
        for (let p = 1; p <= phaseCount; p++) {
          const err = checkRow(feeData[`phase${p}`] || {}, `${courseName} (Phase ${p})`);
          if (err) return err;
        }
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
      const hasAnyOverride = Object.values(phaseLockOverrides).some(Boolean);
      const overriddenPhases = Object.keys(phaseLockOverrides).filter(k => phaseLockOverrides[k]);
      const payload = {
        ...editFormData,
        admin_override: hasAnyOverride,
        admin_override_phases: overriddenPhases
      };

      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update student profile');

      // ── Auto-sync step1_completed based on authoritative cash collected ────────
      // Rule: any cash collected (> 0) or fully paid/waived → admitted (1); 0 cash collected and unpaid → not admitted (0).
      const studentIdForProgress = student.id || student.user_id;
      const enrollmentsToCheck = fullStudent?.enrollments || student?.enrollments || [];

      const syncPromises = enrollmentsToCheck.map(async (enr) => {
        // Prevent touching defined courses — they use student_phase_results and courseProgressService
        if (enr.course_definition_id) return;

        const cn = enr.course_name;
        const courseFees = editFormData.course_fees?.[cn];
        if (!courseFees) return;

        const batchFee = batchFeesRef.current[cn];
        let hasPayment = false;

        if (cn === 'Online Filmmaking Course') {
          const ph1 = courseFees.phase1 || {};
          const acct = resolveFeeAccounting(ph1, { grossFeeOverride: batchFee?.phase1_fee });
          hasPayment = acct.cashCollected > 0 || acct.isPaid;
        } else {
          const acct = resolveFeeAccounting(courseFees, { grossFeeOverride: batchFee?.full_fee });
          hasPayment = acct.cashCollected > 0 || acct.isPaid;
        }

        const targetStep1Val = hasPayment ? 1 : 0;

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
                    const courseEnr = fullStudent?.enrollments?.find(e => e.course_name === courseName);
                    const isMultiPhase = isOFC || (courseEnr?.course_definition_id && (courseEnr?.defined_progress?.phaseCount > 1 || editFormData.course_fees?.[courseName]?.phase2));
                    const phaseCount = isOFC ? 2 : (courseEnr?.defined_progress?.phaseCount || (editFormData.course_fees?.[courseName]?.phase2 ? 2 : 1));
                    
                    return (
                      <div key={courseName} style={{ padding: '0.8rem', background: 'rgba(255,255,255,0.025)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <p style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '0.7rem', letterSpacing: '0.01em' }}>{courseName}</p>
                        {(isMultiPhase && phaseCount > 1) ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            {Array.from({ length: phaseCount }, (_, i) => i + 1).map((pNum) => {
                              const pKey = `phase${pNum}`;
                              const overrideKey = `${courseName}:${pKey}`;
                              const isOverridden = Boolean(phaseLockOverrides[overrideKey]);

                              // 1. Downstream lock: if any phase k > pNum has recorded payments
                              let downstreamLocked = false;
                              let downstreamLockMsg = '';
                              for (let k = pNum + 1; k <= phaseCount; k++) {
                                const nextData = editFormData.course_fees?.[courseName]?.[`phase${k}`] || {};
                                const nextBatchFee = (() => {
                                  const r = batchFeesRef.current[courseName];
                                  if (!r) return null;
                                  return r[`phase${k}_fee`] || null;
                                })();
                                const nextAcct = resolveFeeAccounting(nextData, { grossFeeOverride: nextBatchFee });
                                const hasDirectPayment = parseFloat(String(nextData.direct_payment ?? nextData.down_payment ?? 0).replace(/[^\d.]/g, '')) > 0;
                                const hasRecordedPayment = nextAcct.cashCollected > 0 || hasDirectPayment || (nextData.installments || []).some(inst => (inst.status || '').toLowerCase() === 'paid' && parseFloat(String(inst.amount || '').replace(/[^\d.]/g, '')) > 0);
                                if (hasRecordedPayment) {
                                  downstreamLocked = true;
                                  downstreamLockMsg = `Locked: Phase ${k} has recorded payments`;
                                  break;
                                }
                              }

                              // 2. Upstream lock: if pNum > 1, check previous phase eligibility & fee
                              let upstreamLocked = false;
                              let upstreamLockMsg = '';
                              if (pNum > 1) {
                                const prevPNum = pNum - 1;
                                const prevData = editFormData.course_fees?.[courseName]?.[`phase${prevPNum}`] || {};
                                const prevBatchFee = (() => {
                                  const r = batchFeesRef.current[courseName];
                                  if (!r) return null;
                                  return r[`phase${prevPNum}_fee`] || null;
                                })();
                                const prevAcct = resolveFeeAccounting(prevData, { grossFeeOverride: prevBatchFee });
                                // Authoritative: an underfunded phase with status "Paid" will return isPaid === false!
                                const isPrevFeePaid = prevAcct.isPaid;

                                let isPrevPassed = false;
                                if (isOFC) {
                                  isPrevPassed = courseEnr ? courseEnr.step2_completed === 1 : false;
                                } else {
                                  const defPhases = courseEnr?.defined_progress?.phases || [];
                                  const prevDefPhase = defPhases[prevPNum - 1];
                                  isPrevPassed = prevDefPhase ? Boolean(prevDefPhase.isPassed) : false;
                                }

                                const phaseGate = courseEnr?.defined_progress?.definition?.completion_policy?.phaseGates?.[`phase_${pNum}`] 
                                  || courseEnr?.defined_progress?.definition?.completion_policy?.phaseGates?.[`phase${pNum}`];
                                const requirePass = phaseGate ? phaseGate.previousPhasePassed !== false : true;
                                const requireFee = phaseGate ? phaseGate.feePaid !== false : true;

                                const passFailed = requirePass && !isPrevPassed;
                                const feeFailed = requireFee && !isPrevFeePaid;

                                if (passFailed && feeFailed) {
                                  upstreamLocked = true;
                                  upstreamLockMsg = `Locked: Phase ${prevPNum} passed & Phase ${prevPNum} fee fully paid required`;
                                } else if (passFailed) {
                                  upstreamLocked = true;
                                  upstreamLockMsg = `Locked: Phase ${prevPNum} passed required`;
                                } else if (feeFailed) {
                                  upstreamLocked = true;
                                  upstreamLockMsg = `Locked: Phase ${prevPNum} fee fully paid required`;
                                }
                              }

                              const isLocked = downstreamLocked || upstreamLocked;
                              const lockMessage = downstreamLockMsg || upstreamLockMsg;
                              const isRowDisabled = isLocked && !isOverridden;

                              return (
                                <FeeRow 
                                  key={pKey}
                                  courseName={courseName}
                                  label={`Phase ${pNum}`} 
                                  phaseKey={pKey} 
                                  feeData={editFormData.course_fees}
                                  onChange={handleCourseFeeChange}
                                  onDiscountBlur={handleDiscountBlur}
                                  onRemoveInstallment={handleRemoveInstallment}
                                  onAddInstallment={handleAddInstallment}
                                  onInstallmentChange={handleInstallmentChange}
                                  disabled={isRowDisabled}
                                  lockMessage={lockMessage}
                                  onUnlockClick={() => togglePhaseLock(courseName, pKey)}
                                  isOverridden={isOverridden}
                                  batchFeeValue={(() => {
                                    const r = batchFeesRef.current[courseName];
                                    if (!r) return null;
                                    return r[`phase${pNum}_fee`] || null;
                                  })()}
                                />
                              );
                            })}
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
