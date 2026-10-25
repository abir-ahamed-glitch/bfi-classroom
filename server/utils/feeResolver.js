import db from '../db/database.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Parse fee_details JSON safely
// ─────────────────────────────────────────────────────────────────────────────
export function parseFeeDetails(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Resolve discount amount from percentage or monetary string/number
// Unambiguously computes monetary value from fullFee if discount is a percentage string (e.g. "50%")
// or returns numeric amount if already a number or numeric string.
// ─────────────────────────────────────────────────────────────────────────────
export function resolveDiscountAmount(discount, fullFee = 0, explicitDiscountAmount = null) {
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

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Get batch-defined fee from batch_course_fees table
// Returns { phase1_fee, phase2_fee, full_fee, is_custom } or null if not found
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Create an in-memory resolution context to eliminate N+1 DB queries
// Pre-loads course definitions, batches, and batch fees into Maps for O(1) lookups
// ─────────────────────────────────────────────────────────────────────────────
export function createFeeResolverContext(customDb = null) {
  const activeDb = customDb || db;
  try {
    const definitions = activeDb.prepare('SELECT id, phase_count, definition_json FROM course_definitions').all();
    const definitionById = new Map();
    for (const d of definitions) {
      let parsed = null;
      try {
        parsed = typeof d.definition_json === 'string' ? JSON.parse(d.definition_json) : d.definition_json;
      } catch { /* ignore */ }
      definitionById.set(d.id, { ...d, parsed });
    }

    const batches = activeDb.prepare('SELECT id, course_definition_id, course_name, batch_number FROM batches').all();
    const batchById = new Map();
    const batchesByCourseAndBatchNum = new Map();
    for (const b of batches) {
      batchById.set(b.id, b);
      if (b.course_name && b.batch_number) {
        const key = `${b.course_name.toLowerCase().trim()}:::${String(b.batch_number).trim()}`;
        if (!batchesByCourseAndBatchNum.has(key)) {
          batchesByCourseAndBatchNum.set(key, []);
        }
        batchesByCourseAndBatchNum.get(key).push(b);
      }
    }

    const fees = activeDb.prepare('SELECT id, batch_id, course_name, batch_number, phase1_fee, phase2_fee, full_fee FROM batch_course_fees').all();
    const batchFeeByBatchId = new Map();
    const batchFeeByCourseAndBatchNum = new Map();
    const batchFeeDefaultByCourse = new Map();
    for (const f of fees) {
      if (f.batch_id) {
        batchFeeByBatchId.set(f.batch_id, f);
      }
      if (f.course_name && f.batch_number) {
        const cKey = f.course_name.toLowerCase().trim();
        const bKey = String(f.batch_number).trim();
        if (bKey === 'DEFAULT') {
          batchFeeDefaultByCourse.set(cKey, f);
        } else if (!f.batch_id) {
          batchFeeByCourseAndBatchNum.set(`${cKey}:::${bKey}`, f);
        }
      }
    }

    return {
      db: activeDb,
      definitionById,
      batchById,
      batchesByCourseAndBatchNum,
      batchFeeByBatchId,
      batchFeeByCourseAndBatchNum,
      batchFeeDefaultByCourse,
    };
  } catch (err) {
    console.error('Error creating fee resolver context:', err);
    return null;
  }
}

export function getBatchFee(courseName, batchNumber, customDb = null, batchId = null, feeContext = null) {
  const activeDb = customDb || db;
  const ctx = feeContext;
  try {
    if (ctx) {
      if (batchId) {
        const res = ctx.batchFeeByBatchId.get(batchId);
        if (res) return { ...res, is_custom: true };

        const batchRow = ctx.batchById.get(batchId);
        if (batchRow && batchRow.course_definition_id) {
          const cKey = batchRow.course_name ? batchRow.course_name.toLowerCase().trim() : '';
          const bKey = batchRow.batch_number ? String(batchRow.batch_number).trim() : '';
          const pairKey = `${cKey}:::${bKey}`;

          const unlinkedRow = ctx.batchFeeByCourseAndBatchNum.get(pairKey);
          if (unlinkedRow) {
            const matchingCount = (ctx.batchesByCourseAndBatchNum.get(pairKey) || []).length;
            if (matchingCount === 1) {
              return {
                phase1_fee: unlinkedRow.phase1_fee,
                phase2_fee: unlinkedRow.phase2_fee,
                full_fee: unlinkedRow.full_fee,
                is_custom: true
              };
            }
          }

          const defRow = ctx.definitionById.get(batchRow.course_definition_id);
          if (defRow && defRow.parsed) {
            const phases = Array.isArray(defRow.parsed.phases) ? defRow.parsed.phases : [];
            const p1Fee = phases[0] ? (Number(phases[0].feeAmount ?? phases[0].fee ?? phases[0].fee_amount) || 0) : 0;
            const p2Fee = phases[1] ? (Number(phases[1].feeAmount ?? phases[1].fee ?? phases[1].fee_amount) || 0) : 0;
            const totalFee = phases.reduce((acc, p) => acc + (Number(p.feeAmount ?? p.fee ?? p.fee_amount) || 0), 0);

            return {
              phase1_fee: p1Fee,
              phase2_fee: p2Fee,
              full_fee: totalFee,
              is_custom: false
            };
          }

          const defaultFee = ctx.batchFeeDefaultByCourse.get(cKey || (courseName ? courseName.toLowerCase().trim() : ''));
          if (defaultFee) return { ...defaultFee, is_custom: false };
          return null;
        }
      }

      if (!courseName && !batchNumber) return null;

      if (courseName && batchNumber) {
        const pairKey = `${courseName.toLowerCase().trim()}:::${String(batchNumber).trim()}`;
        const matchingBatches = ctx.batchesByCourseAndBatchNum.get(pairKey) || [];

        if (matchingBatches.length === 1) {
          return getBatchFee(courseName, batchNumber, activeDb, matchingBatches[0].id, ctx);
        }

        if (matchingBatches.length === 0) {
          const res = ctx.batchFeeByCourseAndBatchNum.get(pairKey);
          if (res) return { ...res, is_custom: true };
        }

        const defaultRes = ctx.batchFeeDefaultByCourse.get(courseName.toLowerCase().trim());
        if (defaultRes) return { ...defaultRes, is_custom: false };
      }

      if (courseName) {
        const lowerName = courseName.toLowerCase().trim();
        if (lowerName === 'film appreciation course' || lowerName.includes('appreciation')) {
          return { phase1_fee: 8000, phase2_fee: 0, full_fee: 8000, is_custom: false };
        } else if (lowerName === 'online filmmaking course' || lowerName.includes('filmmaking')) {
          return { phase1_fee: 4000, phase2_fee: 4000, full_fee: 8000, is_custom: false };
        }
      }
      return null;
    }
    // 1. Try specific batch_id first
    if (batchId) {
      const res = activeDb.prepare(
        'SELECT phase1_fee, phase2_fee, full_fee FROM batch_course_fees WHERE batch_id = ? LIMIT 1'
      ).get(batchId);
      if (res) return { ...res, is_custom: true };

      // Batch has no specific batch_course_fees row.
      // Check if this batch belongs to a course definition:
      const batchRow = activeDb.prepare(
        'SELECT id, course_definition_id, course_name, batch_number FROM batches WHERE id = ?'
      ).get(batchId);

      if (batchRow && batchRow.course_definition_id) {
        // Defined batch without specific batch_id row in batch_course_fees.
        // Check if there is an unlinked custom fee row for (course_name, batch_number)
        // that unambiguously belongs to this single batch (matchingBatchesCount === 1).
        const unlinkedRow = activeDb.prepare(
          'SELECT id, phase1_fee, phase2_fee, full_fee FROM batch_course_fees WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?)) AND TRIM(batch_number) = TRIM(?) AND batch_id IS NULL LIMIT 1'
        ).get(batchRow.course_name, String(batchRow.batch_number));

        if (unlinkedRow) {
          const matchingBatchesCount = activeDb.prepare(
            'SELECT COUNT(*) as c FROM batches WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?)) AND TRIM(batch_number) = TRIM(?)'
          ).get(batchRow.course_name, String(batchRow.batch_number))?.c || 0;

          if (matchingBatchesCount === 1) {
            // Unambiguous single batch — return custom fee strictly read-only without modifying payment configuration
            return {
              phase1_fee: unlinkedRow.phase1_fee,
              phase2_fee: unlinkedRow.phase2_fee,
              full_fee: unlinkedRow.full_fee,
              is_custom: true
            };
          }
        }

        // Defined batch without specific batch fee override!
        // MUST NEVER fall back to another batch's row matching (course_name, batch_number).
        // Check if course definition defines fee policy in its phases:
        const defRow = activeDb.prepare(
          'SELECT definition_json FROM course_definitions WHERE id = ?'
        ).get(batchRow.course_definition_id);

        if (defRow && defRow.definition_json) {
          try {
            const defJson = typeof defRow.definition_json === 'string'
              ? JSON.parse(defRow.definition_json)
              : defRow.definition_json;
            const phases = Array.isArray(defJson.phases) ? defJson.phases : [];
            const p1Fee = phases[0] ? (Number(phases[0].feeAmount ?? phases[0].fee ?? phases[0].fee_amount) || 0) : 0;
            const p2Fee = phases[1] ? (Number(phases[1].feeAmount ?? phases[1].fee ?? phases[1].fee_amount) || 0) : 0;
            const totalFee = phases.reduce((acc, p) => acc + (Number(p.feeAmount ?? p.fee ?? p.fee_amount) || 0), 0);

            return {
              phase1_fee: p1Fee,
              phase2_fee: p2Fee,
              full_fee: totalFee,
              is_custom: false
            };
          } catch { /* empty */ }
        }

        // Try global default course fee defined by admin for this course name
        const defaultFee = activeDb.prepare(
          'SELECT phase1_fee, phase2_fee, full_fee FROM batch_course_fees WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?)) AND TRIM(batch_number) = \'DEFAULT\' LIMIT 1'
        ).get(batchRow.course_name || courseName);
        if (defaultFee) return { ...defaultFee, is_custom: false };

        return null;
      }
    }

    if (!courseName && !batchNumber) return null;

    // 2. Lookup by course_name and batch_number when batchId is not provided
    if (courseName && batchNumber) {
      const matchingBatches = activeDb.prepare(
        'SELECT id FROM batches WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?)) AND TRIM(batch_number) = TRIM(?)'
      ).all(courseName, String(batchNumber));

      if (matchingBatches.length === 1) {
        // Unambiguous batch in batches table — delegate to batch_id lookup
        return getBatchFee(courseName, batchNumber, activeDb, matchingBatches[0].id);
      }

      if (matchingBatches.length === 0) {
        // Unlinked legacy records
        const res = activeDb.prepare(
          'SELECT phase1_fee, phase2_fee, full_fee FROM batch_course_fees WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?)) AND TRIM(batch_number) = TRIM(?) AND batch_id IS NULL LIMIT 1'
        ).get(courseName, String(batchNumber));
        if (res) return { ...res, is_custom: true };
      }

      // 3. Try global default course fee defined by admin
      const defaultRes = activeDb.prepare(
        'SELECT phase1_fee, phase2_fee, full_fee FROM batch_course_fees WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?)) AND TRIM(batch_number) = \'DEFAULT\' LIMIT 1'
      ).get(courseName);
      if (defaultRes) return { ...defaultRes, is_custom: false };
    }

    // Default fallbacks if not defined by admin in the DB (for legacy courses)
    if (courseName) {
      const lowerName = courseName.toLowerCase().trim();
      if (lowerName === 'film appreciation course' || lowerName.includes('appreciation')) {
        return { phase1_fee: 8000, phase2_fee: 0, full_fee: 8000, is_custom: false };
      } else if (lowerName === 'online filmmaking course' || lowerName.includes('filmmaking')) {
        return { phase1_fee: 4000, phase2_fee: 4000, full_fee: 8000, is_custom: false };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTHORITATIVE PHASE FEE RESOLVER
// Single source of truth for phase fees, distinguishing genuinely free phases ($0)
// from fee-charging phases whose payment records are absent, malformed, or underfunded.
// Reconciles gross fee, discount, net payable, cash collected, and remaining due.
// A status label alone ("Paid", "Paid Full") never creates cash or clears an unpaid balance.
// ─────────────────────────────────────────────────────────────────────────────
export function resolvePhaseFee({
  feeDetailsRaw = null,
  phaseIndex = 0,
  enrollment = null,
  courseDefinition = null,
  courseDefId = null,
  courseName = null,
  courseType = null,
  batchNumber = null,
  batchId = null,
  batchFee: explicitBatchFee = null,
  customDb = null,
  feeContext = null
} = {}) {
  const activeDb = customDb || db;
  const pIdx = Number(phaseIndex) || 0;

  // 1. Safely parse fee_details JSON
  const rawData = feeDetailsRaw !== null && feeDetailsRaw !== undefined ? feeDetailsRaw : enrollment?.fee_details;
  const feeDetails = parseFeeDetails(rawData);

  // 2. Resolve course definition if not explicitly provided
  let definition = courseDefinition;
  if (!definition && (courseDefId || enrollment?.course_definition_id)) {
    const targetDefId = courseDefId || enrollment?.course_definition_id;
    try {
      const defRow = activeDb.prepare('SELECT definition_json FROM course_definitions WHERE id = ?').get(targetDefId);
      if (defRow?.definition_json) {
        definition = typeof defRow.definition_json === 'string' ? JSON.parse(defRow.definition_json) : defRow.definition_json;
      }
    } catch { /* empty */ }
  }

  // 3. Resolve course identity & batch details
  let effectiveCourseName = courseName || enrollment?.course_name;
  let effectiveCourseType = courseType || enrollment?.course_type;
  let effectiveBatchNumber = batchNumber;

  if (!effectiveBatchNumber && (batchId || enrollment?.batch_id)) {
    const targetBatchId = batchId || enrollment?.batch_id;
    try {
      const bRow = activeDb.prepare('SELECT batch_number, course_name FROM batches WHERE id = ?').get(targetBatchId);
      if (bRow) {
        effectiveBatchNumber = bRow.batch_number;
        if (!effectiveCourseName) effectiveCourseName = bRow.course_name;
      }
    } catch { /* empty */ }
  }

  if (!effectiveBatchNumber && enrollment?.user_id) {
    try {
      const pRow = activeDb.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(enrollment.user_id);
      if (pRow) effectiveBatchNumber = pRow.batch_number;
    } catch { /* empty */ }
  }

  // 4. Resolve destination batch fee schedule
  const targetBatchId = batchId || enrollment?.batch_id || null;
  const batchFee = explicitBatchFee || (targetBatchId
    ? getBatchFee(effectiveCourseName, effectiveBatchNumber, activeDb, targetBatchId, feeContext)
    : ((effectiveCourseName && effectiveBatchNumber) ? getBatchFee(effectiveCourseName, effectiveBatchNumber, activeDb, null, feeContext) : null));

  // 5. Determine expected base fee for this phase
  let expectedBaseFee = 0;
  let hasExplicitPhaseFee = false;

  if (definition && Array.isArray(definition.phases) && definition.phases[pIdx]) {
    const phaseDef = definition.phases[pIdx];
    if (batchFee && batchFee.is_custom) {
      if (pIdx === 0 && (batchFee.phase1_fee !== undefined || batchFee.full_fee !== undefined)) {
        expectedBaseFee = batchFee.phase1_fee ?? batchFee.full_fee ?? 0;
        hasExplicitPhaseFee = true;
      } else if (pIdx === 1 && batchFee.phase2_fee !== undefined) {
        expectedBaseFee = batchFee.phase2_fee ?? 0;
        hasExplicitPhaseFee = true;
      }
    }
    if (!hasExplicitPhaseFee) {
      if (phaseDef.feeAmount !== undefined && phaseDef.feeAmount !== null && phaseDef.feeAmount !== '') {
        expectedBaseFee = Math.max(0, parseFloat(String(phaseDef.feeAmount).replace(/[^\d.]/g, '')) || 0);
        hasExplicitPhaseFee = true;
      } else if (phaseDef.fee !== undefined && phaseDef.fee !== null && phaseDef.fee !== '') {
        expectedBaseFee = Math.max(0, parseFloat(String(phaseDef.fee).replace(/[^\d.]/g, '')) || 0);
        hasExplicitPhaseFee = true;
      } else if (phaseDef.fee_amount !== undefined && phaseDef.fee_amount !== null && phaseDef.fee_amount !== '') {
        expectedBaseFee = Math.max(0, parseFloat(String(phaseDef.fee_amount).replace(/[^\d.]/g, '')) || 0);
        hasExplicitPhaseFee = true;
      } else if (batchFee) {
        if (pIdx === 0) expectedBaseFee = batchFee.phase1_fee ?? batchFee.full_fee ?? 0;
        else if (pIdx === 1) expectedBaseFee = batchFee.phase2_fee ?? 0;
        else expectedBaseFee = 0;
      }
    }
  } else {
    // Legacy courses (OFC, Film Appreciation, workshops)
    if (effectiveCourseType === 'filmmaking' || (effectiveCourseName && effectiveCourseName.toLowerCase().includes('filmmaking'))) {
      if (pIdx === 0) expectedBaseFee = batchFee ? (batchFee.phase1_fee ?? 4000) : 4000;
      else if (pIdx === 1) expectedBaseFee = batchFee ? (batchFee.phase2_fee ?? 4000) : 4000;
      else expectedBaseFee = 0;
    } else {
      if (pIdx === 0) expectedBaseFee = batchFee ? (batchFee.full_fee ?? batchFee.phase1_fee ?? 0) : 0;
      else expectedBaseFee = 0;
    }
  }

  // 6. Extract phase payment record from feeDetails if available
  let phaseRecord = null;
  if (feeDetails) {
    if (Array.isArray(feeDetails.phases) && feeDetails.phases[pIdx] !== undefined) {
      phaseRecord = feeDetails.phases[pIdx];
    } else if (feeDetails[`phase${pIdx + 1}`] !== undefined) {
      phaseRecord = feeDetails[`phase${pIdx + 1}`];
    } else if (pIdx === 0 && (
      feeDetails.full_fee !== undefined ||
      feeDetails.amount_paid !== undefined ||
      feeDetails.status !== undefined ||
      feeDetails.installments !== undefined ||
      feeDetails.discount !== undefined ||
      feeDetails.discount_amount !== undefined ||
      feeDetails.direct_payment !== undefined ||
      feeDetails.down_payment !== undefined
    )) {
      phaseRecord = feeDetails;
    }
  }

  // 7. Reconcile Gross Fee
  let grossFee = expectedBaseFee;
  if (phaseRecord && typeof phaseRecord === 'object') {
    const recordedFull = parseFloat(String(phaseRecord.full_fee || '').replace(/[^\d.]/g, ''));
    if (!isNaN(recordedFull) && recordedFull > 0) {
      grossFee = recordedFull;
    } else if (!hasExplicitPhaseFee && recordedFull === 0 && phaseRecord.full_fee !== undefined && phaseRecord.full_fee !== '') {
      grossFee = 0;
    }
  }
  grossFee = Math.max(0, grossFee);

  // 8. Case A: Genuinely Free Phase (grossFee === 0)
  if (grossFee === 0) {
    return {
      isPaid: true,
      status: 'Free',
      grossFee: 0,
      expectedFee: 0,
      discount: 0,
      discountAmount: 0,
      netPayable: 0,
      cashCollected: 0,
      amountPaid: 0,
      remainingDue: 0,
      hasPayment: false,
      isFree: true,
      isWaived: false,
      isMissingRecord: false,
      overpayment: 0,
      phaseRecord: phaseRecord || null
    };
  }

  // 9. Case B: Fee-charging phase with Missing/Malformed Record
  if (!phaseRecord || typeof phaseRecord !== 'object') {
    return {
      isPaid: false,
      status: 'Pending',
      grossFee,
      expectedFee: grossFee,
      discount: 0,
      discountAmount: 0,
      netPayable: grossFee,
      cashCollected: 0,
      amountPaid: 0,
      remainingDue: grossFee,
      hasPayment: false,
      isFree: false,
      isWaived: false,
      isMissingRecord: true,
      overpayment: 0,
      phaseRecord: null
    };
  }

  // 10. Case C: Fee-charging phase with Recorded Data
  const rawStatus = (phaseRecord.status || '').toLowerCase().trim();
  const isWaived = rawStatus === 'waived' || rawStatus === 'waived / free';

  // Resolve discount: check phase record, then inherit course-level discount (e.g. multi-phase re-enrollment discount)
  let phaseDiscount = phaseRecord.discount;
  let explicitDiscount = (phaseRecord.discount_amount !== undefined && phaseRecord.discount_amount !== null)
    ? Number(phaseRecord.discount_amount)
    : null;

  if (phaseDiscount === undefined && explicitDiscount === null && feeDetails) {
    if (feeDetails.discount_percentage !== undefined && feeDetails.discount_percentage !== null) {
      phaseDiscount = `${feeDetails.discount_percentage}%`;
    } else if (feeDetails.discount !== undefined && String(feeDetails.discount).includes('%')) {
      phaseDiscount = feeDetails.discount;
    }
  }

  const rawDiscountAmount = resolveDiscountAmount(phaseDiscount, grossFee, explicitDiscount);
  const discount = Math.min(grossFee, Math.max(0, rawDiscountAmount || 0));
  const netPayable = isWaived ? 0 : Math.max(0, grossFee - discount);

  // 11. Reconcile Cash Collected from Installments and Direct Payments
  // DATA CONTRACT FOR PAYMENT AMOUNTS:
  // 1. `direct_payment` / `down_payment`: Explicit numeric field for upfront payments
  //    made outside the installment schedule. When present, cashCollected = direct_payment + instPaidSum.
  // 2. `amount_paid`: General/legacy payment field. When present alongside an `installments` array
  //    without explicit `direct_payment`, it is treated as a cumulative payment total or schedule mirror.
  //    To prevent double counting cash, we apply a deterministic conservative rule:
  //    cashCollected = Math.max(amount_paid, instPaidSum).
  //    We NEVER infer extra cash by adding amount_paid and instPaidSum merely because their sum fits the fee.
  // 3. No installments array: Pure direct payment where cashCollected = amount_paid.
  const installments = Array.isArray(phaseRecord.installments) ? phaseRecord.installments : [];
  let instPaidSum = 0;

  for (const inst of installments) {
    const amt = Math.max(0, parseFloat(String(inst.amount || '').replace(/[^\d.]/g, '')) || 0);
    const st = (inst.status || '').toLowerCase().trim();
    if (st === 'paid') {
      instPaidSum += amt;
    }
  }

  // Check explicit direct payment fields
  let rawDirectPaid = null;
  if (phaseRecord.direct_payment !== undefined && phaseRecord.direct_payment !== null) {
    rawDirectPaid = Math.max(0, parseFloat(String(phaseRecord.direct_payment).replace(/[^\d.]/g, '')) || 0);
  } else if (phaseRecord.down_payment !== undefined && phaseRecord.down_payment !== null) {
    rawDirectPaid = Math.max(0, parseFloat(String(phaseRecord.down_payment).replace(/[^\d.]/g, '')) || 0);
  }

  const recAmountPaid = phaseRecord.amount_paid !== undefined && phaseRecord.amount_paid !== null
    ? Math.max(0, parseFloat(String(phaseRecord.amount_paid).replace(/[^\d.]/g, '')) || 0)
    : 0;

  let cashCollected = 0;

  if (rawDirectPaid !== null) {
    // Explicit separate direct/down payment specified alongside installments without collision
    cashCollected = rawDirectPaid + instPaidSum;
  } else if (installments.length === 0) {
    // No installments array present: pure direct payment
    cashCollected = recAmountPaid;
  } else {
    // Installments array present without explicit direct_payment:
    // Apply deterministic conservative rule: amount_paid is treated as cumulative or schedule mirror.
    // Never add amount_paid and instPaidSum from arithmetic fit alone.
    cashCollected = Math.max(recAmountPaid, instPaidSum);
  }

  // 12. Reconcile Remaining Due & Overpayment
  // ACCOUNTING IDENTITY IN EVERY NON-WAIVED CASE:
  // Net Payable = Cash Collected + Remaining Due - Overpayment
  // Gross Fee = Discount + Net Payable
  // remainingDue must ALWAYS be Math.max(0, netPayable - cashCollected).
  // It must never be replaced by instUnpaidSum, which overstates debt after a discount.
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

  // 13. Financial Reality Gate: A status label ALONE ("Paid", "Paid Full") can NEVER mark underfunded tuition as paid!
  const isPaid = isWaived || (netPayable === 0 && grossFee > 0) || (remainingDue === 0 && (cashCollected > 0 || netPayable === 0));

  // Determine authoritative status label based strictly on financial evidence
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
    isPaid,
    status,
    grossFee,
    expectedFee: grossFee,
    discount,
    discountAmount: discount,
    netPayable,
    cashCollected,
    amountPaid: cashCollected,
    remainingDue,
    hasPayment: cashCollected > 0,
    isFree: false,
    isWaived,
    isMissingRecord: false,
    overpayment,
    phaseRecord
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Determine fee status from fee_details JSON
// Returns 'paid' | 'partial' | 'unpaid'
// ─────────────────────────────────────────────────────────────────────────────
export function getFeeStatus(feeDetails, courseType, batchFee, options = {}) {
  const parsed = parseFeeDetails(feeDetails);
  const def = options.courseDefinition || null;
  const customDb = options.customDb || null;
  const feeContext = options.feeContext || null;

  let phaseCount = 1;
  if (def && Array.isArray(def.phases) && def.phases.length > 0) {
    phaseCount = def.phases.length;
  } else if (parsed && Array.isArray(parsed.phases) && parsed.phases.length > 0) {
    phaseCount = parsed.phases.length;
  } else if (courseType === 'filmmaking') {
    phaseCount = 2;
  }

  const phaseResults = [];
  for (let i = 0; i < phaseCount; i++) {
    phaseResults.push(resolvePhaseFee({
      feeDetailsRaw: parsed,
      phaseIndex: i,
      courseDefinition: def,
      courseDefId: options.courseDefId,
      courseName: options.courseName,
      courseType,
      batchNumber: options.batchNumber,
      batchId: options.batchId,
      batchFee,
      customDb,
      feeContext
    }));
  }

  const allPaid = phaseResults.every(r => r.isPaid);
  const anyPayment = phaseResults.some(r => r.hasPayment || r.cashCollected > 0);

  if (allPaid) return 'paid';
  if (anyPayment) return 'partial';
  return 'unpaid';
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Get remaining due for a phase
// ─────────────────────────────────────────────────────────────────────────────
export function getPhaseRemainingDue(phase, fallbackFee = 0) {
  if (!phase) return fallbackFee;
  const res = resolvePhaseFee({
    feeDetailsRaw: phase,
    phaseIndex: 0,
    batchFee: { full_fee: fallbackFee, phase1_fee: fallbackFee }
  });
  return res.remainingDue;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Extract numeric fee amounts
// Analytics must NOT count discounts or waivers as cash collected!
// ─────────────────────────────────────────────────────────────────────────────
export function extractFeeAmounts(feeDetails, courseType, batchFee, options = {}) {
  const parsed = parseFeeDetails(feeDetails);
  const def = options.courseDefinition || null;
  const customDb = options.customDb || null;
  const feeContext = options.feeContext || null;

  let phaseCount = 1;
  if (def && Array.isArray(def.phases) && def.phases.length > 0) {
    phaseCount = def.phases.length;
  } else if (parsed && Array.isArray(parsed.phases) && parsed.phases.length > 0) {
    phaseCount = parsed.phases.length;
  } else if (courseType === 'filmmaking') {
    phaseCount = 2;
  }

  let totalGross = 0;
  let totalDiscount = 0;
  let totalNetPayable = 0;
  let totalCashCollected = 0;
  let totalOutstanding = 0;

  for (let i = 0; i < phaseCount; i++) {
    const res = resolvePhaseFee({
      feeDetailsRaw: parsed,
      phaseIndex: i,
      courseDefinition: def,
      courseDefId: options.courseDefId,
      courseName: options.courseName,
      courseType,
      batchNumber: options.batchNumber,
      batchId: options.batchId,
      batchFee,
      customDb,
      feeContext
    });
    totalGross += res.grossFee;
    totalDiscount += res.discount;
    totalNetPayable += res.netPayable;
    totalCashCollected += res.cashCollected;
    totalOutstanding += res.remainingDue;
  }

  return {
    total: totalGross,
    gross: totalGross,
    discount: totalDiscount,
    netPayable: totalNetPayable,
    collected: totalCashCollected,      // CRITICAL: ONLY real cash collected!
    cashCollected: totalCashCollected,
    outstanding: totalOutstanding
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Resolve entire enrollment status and fee amounts in a single pass
// Computes both status ('paid' | 'partial' | 'unpaid') and financial numbers
// without looping over phases multiple times or querying the DB repeatedly.
// ─────────────────────────────────────────────────────────────────────────────
export function resolveEnrollmentFinancials(feeDetails, courseType, batchFee, options = {}) {
  const parsed = parseFeeDetails(feeDetails);
  const def = options.courseDefinition || null;
  const customDb = options.customDb || null;
  const feeContext = options.feeContext || null;

  let phaseCount = 1;
  if (def && Array.isArray(def.phases) && def.phases.length > 0) {
    phaseCount = def.phases.length;
  } else if (parsed && Array.isArray(parsed.phases) && parsed.phases.length > 0) {
    phaseCount = parsed.phases.length;
  } else if (courseType === 'filmmaking') {
    phaseCount = 2;
  }

  let totalGross = 0;
  let totalDiscount = 0;
  let totalNetPayable = 0;
  let totalCashCollected = 0;
  let totalOutstanding = 0;
  let allPaid = true;
  let anyPayment = false;
  const phaseResults = [];

  for (let i = 0; i < phaseCount; i++) {
    const res = resolvePhaseFee({
      feeDetailsRaw: parsed,
      phaseIndex: i,
      courseDefinition: def,
      courseDefId: options.courseDefId,
      courseName: options.courseName,
      courseType,
      batchNumber: options.batchNumber,
      batchId: options.batchId,
      batchFee,
      customDb,
      feeContext
    });
    phaseResults.push(res);
    totalGross += res.grossFee;
    totalDiscount += res.discount;
    totalNetPayable += res.netPayable;
    totalCashCollected += res.cashCollected;
    totalOutstanding += res.remainingDue;
    if (!res.isPaid) allPaid = false;
    if (res.hasPayment || res.cashCollected > 0) anyPayment = true;
  }

  const status = allPaid ? 'paid' : (anyPayment ? 'partial' : 'unpaid');

  return {
    status,
    phaseResults,
    total: totalGross,
    gross: totalGross,
    discount: totalDiscount,
    netPayable: totalNetPayable,
    collected: totalCashCollected,
    cashCollected: totalCashCollected,
    outstanding: totalOutstanding,
    amounts: {
      total: totalGross,
      gross: totalGross,
      discount: totalDiscount,
      netPayable: totalNetPayable,
      collected: totalCashCollected,
      cashCollected: totalCashCollected,
      outstanding: totalOutstanding
    }
  };
}
