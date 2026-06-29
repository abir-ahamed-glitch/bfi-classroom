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
// HELPER: Get batch-defined fee from batch_course_fees table
// Returns { phase1_fee, phase2_fee, full_fee } or null if not found
// ─────────────────────────────────────────────────────────────────────────────
export function getBatchFee(courseName, batchNumber) {
  if (!courseName || !batchNumber) return null;
  try {
    const res = db.prepare(
      'SELECT phase1_fee, phase2_fee, full_fee FROM batch_course_fees WHERE LOWER(TRIM(course_name)) = LOWER(TRIM(?)) AND TRIM(batch_number) = TRIM(?) LIMIT 1'
    ).get(courseName, String(batchNumber));
    if (res) return res;

    // Default fallbacks if not defined by admin in the DB
    const lowerName = courseName.toLowerCase().trim();
    if (lowerName === 'film appreciation course' || lowerName.includes('appreciation')) {
      return { phase1_fee: 8000, phase2_fee: 0, full_fee: 8000 };
    } else if (lowerName === 'online filmmaking course' || lowerName.includes('filmmaking')) {
      return { phase1_fee: 4000, phase2_fee: 4000, full_fee: 8000 };
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Determine fee status from fee_details JSON
// Returns 'paid' | 'partial' | 'unpaid'
// ─────────────────────────────────────────────────────────────────────────────
// batchFee: optional { phase1_fee, phase2_fee, full_fee } from batch_course_fees
export function getFeeStatus(feeDetails, courseType, batchFee) {
  if (!feeDetails) return 'unpaid';

  let phase1_paid = false;
  let phase2_paid = false;

  // Helper: resolve full_fee with batch fallback
  const resolveFullFee = (phaseObj, batchPhaseKey) => {
    const v = parseFloat((phaseObj.full_fee || '').toString().replace(/[^\d.]/g, '')) || 0;
    if (v > 0) return v;
    return (batchFee && batchFee[batchPhaseKey]) ? batchFee[batchPhaseKey] : 0;
  };

  // 1. Direct field checks if they exist
  if (feeDetails.phase1_paid !== undefined) {
    phase1_paid = !!feeDetails.phase1_paid;
  } else if (courseType === 'filmmaking') {
    if (feeDetails.phase1) {
      const p1 = feeDetails.phase1;
      const status = (p1.status || '').toLowerCase();
      const full = resolveFullFee(p1, 'phase1_fee');
      const paid = parseFloat((p1.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
      const disc = parseFloat((p1.discount || '').toString().replace(/[^\d.]/g, '')) || 0;
      const insts = p1.installments || [];
      phase1_paid = (
        status === 'paid full' ||
        status === 'waived' ||
        full === 0 ||
        (paid + disc >= full) ||
        (insts.length > 0 && insts.every(i => (i.status || '').toLowerCase() === 'paid'))
      );
    }
  } else {
    // For workshop, feeDetails itself represents phase 1/overall
    const p1 = feeDetails;
    const status = (p1.status || '').toLowerCase();
    const full = resolveFullFee(p1, 'full_fee');
    const paid = parseFloat((p1.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
    const disc = parseFloat((p1.discount || '').toString().replace(/[^\d.]/g, '')) || 0;
    const insts = p1.installments || [];
    phase1_paid = (
      status === 'paid full' ||
      status === 'waived' ||
      full === 0 ||
      (paid + disc >= full) ||
      (insts.length > 0 && insts.every(i => (i.status || '').toLowerCase() === 'paid'))
    );
  }

  if (feeDetails.phase2_paid !== undefined) {
    phase2_paid = !!feeDetails.phase2_paid;
  } else if (courseType === 'filmmaking') {
    if (feeDetails.phase2) {
      const p2 = feeDetails.phase2;
      const status = (p2.status || '').toLowerCase();
      const full = resolveFullFee(p2, 'phase2_fee');
      const paid = parseFloat((p2.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
      const disc = parseFloat((p2.discount || '').toString().replace(/[^\d.]/g, '')) || 0;
      const insts = p2.installments || [];
      phase2_paid = (
        status === 'paid full' ||
        status === 'waived' ||
        full === 0 ||
        (paid + disc >= full) ||
        (insts.length > 0 && insts.every(i => (i.status || '').toLowerCase() === 'paid'))
      );
    }
  } else {
    // Workshops have no phase 2, treat as implicitly paid
    phase2_paid = true;
  }

  if (phase1_paid && phase2_paid) return 'paid';
  if (phase1_paid || phase2_paid) return 'partial';
  return 'unpaid';
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Get remaining due for a phase
// ─────────────────────────────────────────────────────────────────────────────
// fallbackFee: numeric fallback full_fee from batch config if phase.full_fee is blank
export function getPhaseRemainingDue(phase, fallbackFee = 0) {
  if (!phase) return fallbackFee;
  const fullFee = (parseFloat((phase.full_fee || '').toString().replace(/[^\d.]/g, '')) || 0) || fallbackFee;
  if (fullFee === 0) return 0;

  const discount = parseFloat((phase.discount || '').toString().replace(/[^\d.]/g, '')) || 0;
  const amountPaid = parseFloat((phase.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
  const installments = phase.installments || [];

  if (installments.length > 0) {
    return installments
      .filter(inst => (inst.status || '').toLowerCase() !== 'paid')
      .reduce((sum, inst) => sum + (parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) || 0), 0);
  }

  return Math.max(0, fullFee - discount - amountPaid);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Extract numeric fee amounts
// ─────────────────────────────────────────────────────────────────────────────
// batchFee: optional { phase1_fee, phase2_fee, full_fee } from batch_course_fees
export function extractFeeAmounts(feeDetails, courseType, batchFee) {
  if (!feeDetails) {
    // No fee_details at all — use pure batch totals
    if (!batchFee) return { total: 0, collected: 0 };
    if (courseType === 'filmmaking') {
      return { total: (batchFee.phase1_fee || 0) + (batchFee.phase2_fee || 0), collected: 0 };
    }
    return { total: batchFee.full_fee || 0, collected: 0 };
  }

  const getPhaseAmounts = (phase, fallbackTotal = 0) => {
    if (!phase) return { total: fallbackTotal, collected: 0 };
    const fullFee = (parseFloat((phase.full_fee || '').toString().replace(/[^\d.]/g, '')) || 0) || fallbackTotal;
    const amountPaid = parseFloat((phase.amount_paid || '').toString().replace(/[^\d.]/g, '')) || 0;
    const discount = parseFloat((phase.discount || '').toString().replace(/[^\d.]/g, '')) || 0;

    let collected = amountPaid;
    if (phase.installments && phase.installments.length > 0) {
      const paidInstSum = phase.installments
        .filter(inst => (inst.status || '').toLowerCase() === 'paid')
        .reduce((sum, inst) => sum + (parseFloat((inst.amount || '').toString().replace(/[^\d.]/g, '')) || 0), 0);
      collected += paidInstSum;
    }

    return { total: fullFee, collected: Math.min(collected + discount, fullFee) };
  };

  if (courseType === 'filmmaking') {
    const p1 = getPhaseAmounts(feeDetails.phase1, batchFee ? batchFee.phase1_fee : 0);
    const p2 = getPhaseAmounts(feeDetails.phase2, batchFee ? batchFee.phase2_fee : 0);
    return {
      total: p1.total + p2.total,
      collected: p1.collected + p2.collected,
    };
  }
  return getPhaseAmounts(feeDetails, batchFee ? (batchFee.full_fee || 0) : 0);
}
