/**
 * Safe discount and fee calculations for client-side views.
 * Supports:
 * - Direct monetary numbers / strings (e.g. 2000, "2000")
 * - Percentage strings (e.g. "50%"), resolved against fullFee
 * - Explicit discount_amount overrides
 */
export function resolveClientDiscount(discount, fullFee = 0, explicitDiscountAmount = null) {
  if (explicitDiscountAmount !== null && explicitDiscountAmount !== undefined && !isNaN(Number(explicitDiscountAmount))) {
    return Math.max(0, Number(explicitDiscountAmount));
  }
  if (!discount && discount !== 0) return 0;
  const str = String(discount).trim();
  if (str.endsWith('%')) {
    const pct = parseFloat(str.replace('%', '').trim()) || 0;
    return Math.max(0, Math.round((Number(fullFee || 0) * pct) / 100));
  }
  const num = parseFloat(str.replace(/[^\d.]/g, '')) || 0;
  return Math.max(0, num);
}

/**
 * Calculate remaining due safely accounting for full fee, discount, and amount paid.
 */
export function calculateRemainingDue(fullFee = 0, amountPaid = 0, discount = 0, explicitDiscountAmount = null) {
  const full = typeof fullFee === 'number' ? fullFee : (parseFloat(String(fullFee || '').replace(/[^\d.]/g, '')) || 0);
  const paid = typeof amountPaid === 'number' ? amountPaid : (parseFloat(String(amountPaid || '').replace(/[^\d.]/g, '')) || 0);
  const disc = resolveClientDiscount(discount, full, explicitDiscountAmount);
  return Math.max(0, full - disc - paid);
}

/**
 * Single Authoritative Client-side Accounting Resolver.
 * Reconciles Gross Fee, Discount, Net Payable, Cash Collected, Remaining Due, and Overpayment
 * matching the server's resolvePhaseFee() accounting contract exactly:
 *
 * Identity 1: Gross Fee = Discount + Net Payable
 * Identity 2: Net Payable = Cash Collected + Remaining Due - Overpayment (in non-waived cases)
 *
 * Data Contract:
 * - direct_payment / down_payment: Explicit upfront payment made alongside installments.
 * - amount_paid: Cumulative payment or schedule mirror alongside installments.
 *   cashCollected = Math.max(amount_paid, instPaidSum).
 * - No installments: cashCollected = amount_paid.
 * - remainingDue = Math.max(0, netPayable - cashCollected).
 * - overpayment = Math.max(0, cashCollected - netPayable).
 * - A status label alone ("Paid", "Paid Full") never creates cash or clears a balance.
 * - All listed installments marked Paid NEVER completes the fee if netPayable remains outstanding.
 */
export function resolveFeeAccounting(data = {}, options = {}) {
  if (!data || typeof data !== 'object') {
    const gross = Math.max(0, parseFloat(String(options.expectedFee || options.grossFeeOverride || 0).replace(/[^\d.]/g, '')) || 0);
    return {
      grossFee: gross,
      discount: 0,
      discountAmount: 0,
      netPayable: gross,
      cashCollected: 0,
      amountPaid: 0,
      remainingDue: gross,
      overpayment: 0,
      isPaid: gross === 0,
      isFullyCompleted: gross === 0,
      status: gross === 0 ? 'Free' : 'Pending',
      isWaived: false,
      isFree: gross === 0,
      hasPayment: false,
      installments: []
    };
  }

  // 1. Resolve gross fee
  let grossFee = 0;
  const recordedFull = parseFloat(String(data.full_fee !== undefined ? data.full_fee : '').replace(/[^\d.]/g, ''));
  if (!isNaN(recordedFull) && recordedFull > 0) {
    grossFee = recordedFull;
  } else if (recordedFull === 0 && data.full_fee !== undefined && data.full_fee !== '') {
    grossFee = 0;
  } else if (options.grossFeeOverride !== undefined && options.grossFeeOverride !== null) {
    grossFee = Math.max(0, parseFloat(String(options.grossFeeOverride).replace(/[^\d.]/g, '')) || 0);
  } else if (options.expectedFee !== undefined && options.expectedFee !== null) {
    grossFee = Math.max(0, parseFloat(String(options.expectedFee).replace(/[^\d.]/g, '')) || 0);
  }

  // 2. Case: Genuinely Free Phase (grossFee === 0)
  if (grossFee === 0) {
    return {
      grossFee: 0,
      discount: 0,
      discountAmount: 0,
      netPayable: 0,
      cashCollected: 0,
      amountPaid: 0,
      remainingDue: 0,
      overpayment: 0,
      isPaid: true,
      isFullyCompleted: true,
      status: 'Free',
      isWaived: false,
      isFree: true,
      hasPayment: false,
      installments: Array.isArray(data.installments) ? data.installments : []
    };
  }

  // 3. Status checks
  const rawStatus = (data.status || '').toLowerCase().trim();
  const isWaived = rawStatus === 'waived' || rawStatus === 'waived / free';

  // 4. Discount
  const discountInput = data.discount !== undefined ? data.discount : options.courseDiscount;
  const rawDiscount = resolveClientDiscount(discountInput, grossFee, data.discount_amount);
  const discount = Math.min(grossFee, Math.max(0, rawDiscount || 0));
  const netPayable = isWaived ? 0 : Math.max(0, grossFee - discount);

  // 5. Cash collected from Installments and Direct Payments
  const installments = Array.isArray(data.installments) ? data.installments : [];
  let instPaidSum = 0;
  for (const inst of installments) {
    const amt = Math.max(0, parseFloat(String(inst.amount || '').replace(/[^\d.]/g, '')) || 0);
    const st = (inst.status || '').toLowerCase().trim();
    if (st === 'paid') {
      instPaidSum += amt;
    }
  }

  let rawDirectPaid = null;
  if (data.direct_payment !== undefined && data.direct_payment !== null && data.direct_payment !== '') {
    rawDirectPaid = Math.max(0, parseFloat(String(data.direct_payment).replace(/[^\d.]/g, '')) || 0);
  } else if (data.down_payment !== undefined && data.down_payment !== null && data.down_payment !== '') {
    rawDirectPaid = Math.max(0, parseFloat(String(data.down_payment).replace(/[^\d.]/g, '')) || 0);
  }

  const recAmountPaid = data.amount_paid !== undefined && data.amount_paid !== null && data.amount_paid !== ''
    ? Math.max(0, parseFloat(String(data.amount_paid).replace(/[^\d.]/g, '')) || 0)
    : 0;

  let cashCollected = 0;
  if (rawDirectPaid !== null) {
    cashCollected = rawDirectPaid + instPaidSum;
  } else if (installments.length === 0) {
    cashCollected = recAmountPaid;
  } else {
    // Deterministic conservative rule: amount_paid is treated as cumulative or schedule mirror
    cashCollected = Math.max(recAmountPaid, instPaidSum);
  }

  // 6. Remaining Due & Overpayment
  let remainingDue = 0;
  let overpayment = 0;

  if (isWaived) {
    remainingDue = 0;
    overpayment = 0;
  } else {
    if (cashCollected >= netPayable) {
      remainingDue = 0;
      overpayment = cashCollected - netPayable;
    } else {
      remainingDue = Math.max(0, netPayable - cashCollected);
      overpayment = 0;
    }
  }

  // 7. Authoritative isPaid & completion flag
  // Crucial: A status label ALONE or all listed installments being Paid can NEVER mark underfunded tuition as paid!
  const isPaid = isWaived || (netPayable === 0 && grossFee > 0) || (remainingDue === 0 && (cashCollected > 0 || netPayable === 0));

  let status = 'Pending';
  if (isWaived) {
    status = 'Waived';
  } else if (isPaid) {
    status = (discount >= grossFee && cashCollected === 0) ? 'Full Discount' : 'Paid Full';
  } else if (cashCollected > 0) {
    status = 'Partial';
  } else {
    status = (rawStatus === 'due' || rawStatus === 'unpaid') ? 'Due' : 'Pending';
  }

  return {
    grossFee,
    discount,
    discountAmount: discount,
    netPayable,
    cashCollected,
    amountPaid: cashCollected,
    remainingDue,
    overpayment,
    isPaid,
    isFullyCompleted: isPaid,
    status,
    isWaived,
    isFree: false,
    hasPayment: cashCollected > 0,
    installments
  };
}

/**
 * Authoritative check whether a course enrollment has any unpaid phase fees or pending balances.
 * Avoids the false-positive completion of underfunded installment plans.
 */
export function isCourseFeeUnpaid(course) {
  if (!course) return false;
  if (course.defined_progress?.hasPendingFee !== undefined) {
    return Boolean(course.defined_progress.hasPendingFee);
  }
  if (course.defined_progress?.phases) {
    return course.defined_progress.phases.some(p => !p.isFeePaid || (p.remainingDue && p.remainingDue > 0));
  }

  if (!course.fee_details) {
    if (course.course_name === 'Online Filmmaking Course' || course.course_type === 'filmmaking') {
      return true;
    }
    return false;
  }

  let feeDetails = {};
  try {
    feeDetails = typeof course.fee_details === 'string'
      ? JSON.parse(course.fee_details)
      : course.fee_details;
  } catch {
    return false;
  }

  if (!feeDetails) return false;

  const isPhaseUnpaid = (phaseData) => {
    if (!phaseData) return false;
    const acct = resolveFeeAccounting(phaseData);
    if (acct.isFree || acct.isWaived) return false;
    return acct.remainingDue > 0 || !acct.isPaid;
  };

  if (course.course_name === 'Online Filmmaking Course' || course.course_type === 'filmmaking') {
    return isPhaseUnpaid(feeDetails.phase1) || isPhaseUnpaid(feeDetails.phase2);
  } else if (Array.isArray(feeDetails.phases) && feeDetails.phases.length > 0) {
    return feeDetails.phases.some(isPhaseUnpaid);
  } else {
    return isPhaseUnpaid(feeDetails);
  }
}
