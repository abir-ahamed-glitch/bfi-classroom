import { test, expect } from '@playwright/test';
import { assertIsolatedTestDatabase, getTestDbPath, initIsolatedTestDatabase } from './test-db-isolation.js';
import {
  resolvePhaseFee,
  parseFeeDetails,
  resolveDiscountAmount,
  getFeeStatus,
  extractFeeAmounts
} from '../server/utils/feeResolver.js';
import {
  getEnrollmentProgressSync,
  admitStudentToPhase,
  evaluateCertificateEligibility,
  isPhaseFeePaid,
  hasPhasePaymentRecorded
} from '../server/services/courseProgressService.js';
import { hasPendingDueOrPartialPayment } from '../server/routes/certification.js';

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);

test.describe('Authoritative Phase-Aware Fee Resolver Suite', () => {
  let db;

  test.beforeAll(async () => {
    db = await initIsolatedTestDatabase(DB_PATH);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Free phase with no fee record
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 1: Free phase with no fee record resolves to isPaid=true, status=Free, remainingDue=0', () => {
    const courseDef = {
      phases: [
        { id: 'p1', phaseIndex: 1, title: 'Orientation & Theory', feeAmount: 0 },
        { id: 'p2', phaseIndex: 2, title: 'Production Lab', feeAmount: 5000 }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: null,
      phaseIndex: 0,
      courseDefinition: courseDef,
      customDb: db
    });

    expect(res.isPaid).toBe(true);
    expect(res.status).toBe('Free');
    expect(res.expectedFee).toBe(0);
    expect(res.remainingDue).toBe(0);
    expect(res.hasPayment).toBe(false);
    expect(res.isFree).toBe(true);
    expect(res.isMissingRecord).toBe(false);

    // Also check isPhaseFeePaid helper directly
    expect(isPhaseFeePaid(null, 0, { courseDefinition: courseDef, customDb: db })).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Paid phase with no fee record
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 2: Fee-charging phase with no fee record resolves to isPaid=false, status=Pending, remainingDue=4000', () => {
    const courseDef = {
      phases: [
        { id: 'p1', phaseIndex: 1, title: 'Screenwriting', feeAmount: 4000 },
        { id: 'p2', phaseIndex: 2, title: 'Directing', feeAmount: 4000 }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: null,
      phaseIndex: 0,
      courseDefinition: courseDef,
      customDb: db
    });

    expect(res.isPaid).toBe(false);
    expect(res.status).toBe('Pending');
    expect(res.expectedFee).toBe(4000);
    expect(res.remainingDue).toBe(4000);
    expect(res.amountPaid).toBe(0);
    expect(res.hasPayment).toBe(false);
    expect(res.isFree).toBe(false);
    expect(res.isMissingRecord).toBe(true);

    // Also check isPhaseFeePaid helper directly
    expect(isPhaseFeePaid(null, 0, { courseDefinition: courseDef, customDb: db })).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Missing Phase 2 record
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 3: Missing Phase 2 record in fee_details correctly leaves Phase 2 unpaid while Phase 1 is paid', () => {
    const courseDef = {
      phases: [
        { id: 'p1', phaseIndex: 1, title: 'Phase One', feeAmount: 4000 },
        { id: 'p2', phaseIndex: 2, title: 'Phase Two', feeAmount: 4000 }
      ]
    };

    // Only Phase 1 was entered/paid; Phase 2 record is absent from fee_details
    const feeDetails = {
      phase1: { status: 'Paid Full', full_fee: 4000, amount_paid: 4000 }
    };

    const p1Res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      courseDefinition: courseDef,
      customDb: db
    });
    expect(p1Res.isPaid).toBe(true);
    expect(p1Res.status).toBe('Paid Full');
    expect(p1Res.remainingDue).toBe(0);

    const p2Res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 1,
      courseDefinition: courseDef,
      customDb: db
    });
    expect(p2Res.isPaid).toBe(false);
    expect(p2Res.status).toBe('Pending');
    expect(p2Res.expectedFee).toBe(4000);
    expect(p2Res.remainingDue).toBe(4000);
    expect(p2Res.isMissingRecord).toBe(true);

    // Overall fee status must be partial, not paid
    expect(getFeeStatus(feeDetails, 'defined', null, { courseDefinition: courseDef, customDb: db })).toBe('partial');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Malformed fee JSON
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 4: Malformed fee JSON is rejected safely without throwing, returning unpaid pending for fee-charging phase', () => {
    const courseDef = {
      phases: [
        { id: 'p1', phaseIndex: 1, title: 'Cinematography', feeAmount: 4500 }
      ]
    };

    const malformedJson = '{"status": "Paid Full", "amount_paid": 4500, corrupt';

    // Must not throw exception
    expect(() => parseFeeDetails(malformedJson)).not.toThrow();
    expect(parseFeeDetails(malformedJson)).toBeNull();

    const res = resolvePhaseFee({
      feeDetailsRaw: malformedJson,
      phaseIndex: 0,
      courseDefinition: courseDef,
      customDb: db
    });

    expect(res.isPaid).toBe(false);
    expect(res.status).toBe('Pending');
    expect(res.expectedFee).toBe(4500);
    expect(res.remainingDue).toBe(4500);
    expect(res.isMissingRecord).toBe(true);

    // Certification check must also treat malformed JSON on fee-charging course as locked
    expect(hasPendingDueOrPartialPayment(malformedJson, 'defined', 'Cinematography', null, null, db, null, { courseDefinition: courseDef })).toBe(true);
    expect(hasPendingDueOrPartialPayment(malformedJson, 'filmmaking', 'Online Filmmaking Course', 'DEFAULT', null, db)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Partial payment
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 5: Partial payment calculates remaining due and marks isPaid=false, status=Partial, hasPayment=true', () => {
    const courseDef = {
      phases: [
        { id: 'p1', phaseIndex: 1, title: 'Sound Design', feeAmount: 4000 }
      ]
    };

    const feeDetails = {
      phases: [
        { status: 'Partial', full_fee: 4000, amount_paid: 1500 }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      courseDefinition: courseDef,
      customDb: db
    });

    expect(res.isPaid).toBe(false);
    expect(res.status).toBe('Partial');
    expect(res.expectedFee).toBe(4000);
    expect(res.amountPaid).toBe(1500);
    expect(res.remainingDue).toBe(2500);
    expect(res.hasPayment).toBe(true);

    // hasPhasePaymentRecorded must be true (blocks undoing admission)
    expect(hasPhasePaymentRecorded(feeDetails, 1, { courseDefinition: courseDef, customDb: db })).toBe(true);

    // extractFeeAmounts must report 4000 total, 1500 collected
    const amounts = extractFeeAmounts(feeDetails, 'defined', null, { courseDefinition: courseDef, customDb: db });
    expect(amounts.total).toBe(4000);
    expect(amounts.collected).toBe(1500);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Full payment
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 6: Full payment satisfies remaining balance with remainingDue=0 and isPaid=true', () => {
    const courseDef = {
      phases: [
        { id: 'p1', phaseIndex: 1, title: 'Color Grading', feeAmount: 4000 }
      ]
    };

    const feeDetails = {
      phases: [
        { status: 'Paid Full', full_fee: 4000, amount_paid: 4000 }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      courseDefinition: courseDef,
      customDb: db
    });

    expect(res.isPaid).toBe(true);
    expect(res.status).toBe('Paid Full');
    expect(res.expectedFee).toBe(4000);
    expect(res.amountPaid).toBe(4000);
    expect(res.remainingDue).toBe(0);
    expect(res.hasPayment).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Waiver
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 7: Fee waiver satisfies phase fee with isPaid=true, status=Waived, remainingDue=0', () => {
    const courseDef = {
      phases: [
        { id: 'p1', phaseIndex: 1, title: 'Documentary Masterclass', feeAmount: 6000 }
      ]
    };

    const feeDetails = {
      phases: [
        { status: 'Waived', full_fee: 6000, amount_paid: 0 }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      courseDefinition: courseDef,
      customDb: db
    });

    expect(res.isPaid).toBe(true);
    expect(res.status).toBe('Waived');
    expect(res.expectedFee).toBe(6000);
    expect(res.remainingDue).toBe(0);
    expect(res.isFree).toBe(false);

    // Overall fee status must be paid
    expect(getFeeStatus(feeDetails, 'defined', null, { courseDefinition: courseDef, customDb: db })).toBe('paid');

    // extractFeeAmounts must recognize full waiver: 0 cash collected (no fabricated cash in analytics), 0 outstanding
    const amounts = extractFeeAmounts(feeDetails, 'defined', null, { courseDefinition: courseDef, customDb: db });
    expect(amounts.total).toBe(6000);
    expect(amounts.collected).toBe(0);
    expect(amounts.outstanding).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. Re-enrollment discount against different batch fees
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 8: Re-enrollment discount applies monetary amount against destination batch fee schedule', () => {
    // Test Batch A: total fee 10,000, 50% discount
    const batchAFee = 10000;
    const discountPct = '50%';
    const discAmountA = resolveDiscountAmount(discountPct, batchAFee);
    expect(discAmountA).toBe(5000);
    const netA = batchAFee - discAmountA;
    expect(netA).toBe(5000);

    // Test Batch B: total fee 12,000, 50% discount
    const batchBFee = 12000;
    const discAmountB = resolveDiscountAmount(discountPct, batchBFee);
    expect(discAmountB).toBe(6000);
    const netB = batchBFee - discAmountB;
    expect(netB).toBe(6000);

    // Verify resolvePhaseFee with discount on 12,000 fee
    const phaseWithDiscount = {
      full_fee: 12000,
      discount: '50%',
      amount_paid: 6000
    };
    const resB = resolvePhaseFee({
      feeDetailsRaw: { phases: [phaseWithDiscount] },
      phaseIndex: 0,
      customDb: db
    });
    expect(resB.isPaid).toBe(true);
    expect(resB.discountAmount).toBe(6000);
    expect(resB.remainingDue).toBe(0);
    expect(resB.status).toBe('Paid Full');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. End-to-end case: Fee-charging Phase 1 CANNOT unlock Phase 2 or certificate
  //    merely because fee_details is null
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 9: Fee-charging Phase 1 cannot unlock Phase 2 or a certificate merely because fee_details is null', async () => {
    // 1. Create a 2-phase course definition with Phase 1 = 4000, Phase 2 = 4000, and strict fee gates
    const defStmt = db.prepare(`
      INSERT INTO course_definitions (
        slug, version, name, course_type, phase_count, status, definition_json, created_by, updated_by
      ) VALUES (?, 1, ?, 'workshop', 2, 'published', ?, 1, 1)
    `);

    const timestamp = Date.now();
    const uniqueSlug = `fee-gating-test-${timestamp}`;
    const courseName = `Fee Gating Test Course ${timestamp}`;

    const defJson = JSON.stringify({
      basics: { name: courseName, type: 'workshop', phaseCount: 2 },
      phases: [
        {
          id: 'p1_fee',
          phaseIndex: 1,
          title: 'Foundation',
          feeAmount: 4000,
          classCount: 1,
          requirements: { attendanceRequired: false, completionRequired: true },
          classes: [{ id: 'c1', title: 'Intro', mandatory: false }],
          assignments: [],
          exam: { enabled: false }
        },
        {
          id: 'p2_fee',
          phaseIndex: 2,
          title: 'Advanced',
          feeAmount: 4000,
          classCount: 1,
          requirements: { attendanceRequired: false, completionRequired: true },
          classes: [{ id: 'c2', title: 'Deep Dive', mandatory: false }],
          assignments: [],
          exam: { enabled: false }
        }
      ],
      completionPolicy: {
        phaseGates: {
          sequentialProgression: true,
          requirePreviousPhasePassed: true,
          requirePreviousPhaseFeesPaid: true
        },
        certificateEligibility: {
          allRequiredPhasesPassed: true,
          requireFeesPaid: true
        }
      }
    });

    const resDef = defStmt.run(uniqueSlug, courseName, defJson);
    const courseDefId = resDef.lastInsertRowid;

    // 2. Insert enrollment for student 8 with fee_details = NULL
    const enrRes = db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, course_definition_id, course_version, fee_details
      ) VALUES (?, ?, 'workshop', ?, 1, NULL)
    `).run(8, courseName, courseDefId);
    const enrollmentId = enrRes.lastInsertRowid;

    // 3. Mark Phase 1 as passed in student_phase_results
    db.prepare(`
      INSERT INTO student_phase_results (
        enrollment_id, phase_id, is_passed, attendance_classes, attendance_total, calculated_at
      ) VALUES (?, 'p1_fee', 1, 1, 1, datetime('now'))
    `).run(enrollmentId);

    // 4. Evaluate progress: Phase 1 fee is NOT paid because fee_details is NULL and feeAmount is 4000
    const progress = getEnrollmentProgressSync(enrollmentId, db);
    expect(progress.phases[0].isFeePaid).toBe(false);
    expect(progress.phases[0].feeStatus).toBe('Pending');
    expect(progress.phases[0].feeAmount).toBe(4000);
    expect(progress.phases[0].remainingDue).toBe(4000);

    // Phase 2 MUST be locked because Phase 1 fees are unpaid!
    expect(progress.phases[1].isLocked).toBe(true);
    expect(progress.phases[1].lockReason).toContain('fees must be fully paid');

    // Overall certificate eligibility MUST be false
    expect(progress.certificateEligible).toBe(false);
    expect(progress.hasPendingFee).toBe(true);

    const certCheck = await evaluateCertificateEligibility(enrollmentId, db);
    expect(certCheck.eligible).toBe(false);

    // Certification route helper MUST return isLocked = true
    const certLocked = hasPendingDueOrPartialPayment(
      null,
      'workshop',
      courseName,
      null,
      courseDefId,
      db,
      { course_definition_id: courseDefId, fee_details: null }
    );
    expect(certLocked).toBe(true);

    // 5. Attempting to admit student to Phase 2 MUST fail with an explicit error
    await expect(admitStudentToPhase(enrollmentId, 2, db)).rejects.toThrow(
      /Cannot admit to Phase 2: Phase 1 fees must be fully paid first/
    );

    // 6. Now simulate paying Phase 1 fee in full
    const p1PaidFeeDetails = JSON.stringify({
      phases: [
        { status: 'Paid Full', full_fee: 4000, amount_paid: 4000 }
      ]
    });
    db.prepare('UPDATE student_course_enrollments SET fee_details = ? WHERE id = ?').run(
      p1PaidFeeDetails,
      enrollmentId
    );

    // Re-evaluate: Phase 1 fee is paid!
    const progressAfterP1Pay = getEnrollmentProgressSync(enrollmentId, db);
    expect(progressAfterP1Pay.phases[0].isFeePaid).toBe(true);
    expect(progressAfterP1Pay.phases[0].feeStatus).toBe('Paid Full');
    expect(progressAfterP1Pay.phases[1].isLocked).toBe(false);

    // Now admitting to Phase 2 succeeds!
    const admittedProgress = await admitStudentToPhase(enrollmentId, 2, db);
    expect(admittedProgress.phases[1].isAdmitted).toBe(true);

    // But Phase 2 fee is still unpaid, so certificate eligibility MUST remain false!
    expect(admittedProgress.certificateEligible).toBe(false);
    expect(admittedProgress.hasPendingFee).toBe(true);

    const certLockedP2 = hasPendingDueOrPartialPayment(
      p1PaidFeeDetails,
      'workshop',
      courseName,
      null,
      courseDefId,
      db,
      { course_definition_id: courseDefId, fee_details: p1PaidFeeDetails }
    );
    expect(certLockedP2).toBe(true);

    // 7. Finally pay Phase 2 fee in full and mark Phase 2 passed
    const allPaidFeeDetails = JSON.stringify({
      phases: [
        { status: 'Paid Full', full_fee: 4000, amount_paid: 4000 },
        { status: 'Paid Full', full_fee: 4000, amount_paid: 4000 }
      ]
    });
    db.prepare('UPDATE student_course_enrollments SET fee_details = ? WHERE id = ?').run(
      allPaidFeeDetails,
      enrollmentId
    );
    db.prepare(`
      INSERT INTO student_phase_results (
        enrollment_id, phase_id, is_passed, attendance_classes, attendance_total, calculated_at
      ) VALUES (?, 'p2_fee', 1, 1, 1, datetime('now'))
      ON CONFLICT(enrollment_id, phase_id) DO UPDATE SET is_passed = 1
    `).run(enrollmentId);

    const finalProgress = getEnrollmentProgressSync(enrollmentId, db);
    expect(finalProgress.phases[1].isFeePaid).toBe(true);
    expect(finalProgress.phases[1].feeStatus).toBe('Paid Full');
    expect(finalProgress.certificateEligible).toBe(true);
    expect(finalProgress.hasPendingFee).toBe(false);

    const finalCertCheck = await evaluateCertificateEligibility(enrollmentId, db);
    expect(finalCertCheck.eligible).toBe(true);

    const certUnlocked = hasPendingDueOrPartialPayment(
      allPaidFeeDetails,
      'workshop',
      courseName,
      null,
      courseDefId,
      db,
      { course_definition_id: courseDefId, fee_details: allPaidFeeDetails }
    );
    expect(certUnlocked).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. Underfunded "Paid" status label with 0 payment:
  //     A status label alone must NOT create cash or clear a balance!
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 10: full_fee=4000, amount_paid=0, status="Paid" resolves to isPaid=false, cashCollected=0, remainingDue=4000, status=Pending', () => {
    const feeDetails = {
      phases: [
        { status: 'Paid', full_fee: 4000, amount_paid: 0 }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    expect(res.isPaid).toBe(false);
    expect(res.cashCollected).toBe(0);
    expect(res.amountPaid).toBe(0);
    expect(res.remainingDue).toBe(4000);
    expect(res.netPayable).toBe(4000);
    expect(res.grossFee).toBe(4000);
    expect(res.discount).toBe(0);
    expect(res.status).toBe('Pending');
    expect(res.hasPayment).toBe(false);

    // Overall fee status must be unpaid
    expect(getFeeStatus(feeDetails, 'workshop', null, { customDb: db })).toBe('unpaid');

    // extractFeeAmounts must report 4000 total, 0 collected, 4000 outstanding
    const amounts = extractFeeAmounts(feeDetails, 'workshop', null, { customDb: db });
    expect(amounts.total).toBe(4000);
    expect(amounts.collected).toBe(0);
    expect(amounts.outstanding).toBe(4000);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. Incomplete installment schedule:
  //     All listed installments paid, but schedule total is less than full fee
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 11: full_fee=4000 and one installment of 1000 marked Paid resolves to isPaid=false, cashCollected=1000, remainingDue=3000, status=Partial', () => {
    const feeDetails = {
      phases: [
        {
          full_fee: 4000,
          installments: [
            { amount: 1000, status: 'Paid' }
          ]
        }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    expect(res.isPaid).toBe(false);
    expect(res.cashCollected).toBe(1000);
    expect(res.remainingDue).toBe(3000);
    expect(res.grossFee).toBe(4000);
    expect(res.netPayable).toBe(4000);
    expect(res.status).toBe('Partial');
    expect(res.hasPayment).toBe(true);

    // Overall fee status must be partial
    expect(getFeeStatus(feeDetails, 'workshop', null, { customDb: db })).toBe('partial');

    // extractFeeAmounts must report 4000 total, 1000 collected, 3000 outstanding
    const amounts = extractFeeAmounts(feeDetails, 'workshop', null, { customDb: db });
    expect(amounts.total).toBe(4000);
    expect(amounts.collected).toBe(1000);
    expect(amounts.outstanding).toBe(3000);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. Underfunded "Paid Full" status:
  //     amount_paid=1500 but status="Paid Full" on 4000 fee
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 12: Underfunded Paid Full status (amount_paid=1500 on 4000 fee) resolves to isPaid=false, status=Partial, remainingDue=2500', () => {
    const feeDetails = {
      phases: [
        { status: 'Paid Full', full_fee: 4000, amount_paid: 1500 }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    expect(res.isPaid).toBe(false);
    expect(res.cashCollected).toBe(1500);
    expect(res.remainingDue).toBe(2500);
    expect(res.status).toBe('Partial');
    expect(res.hasPayment).toBe(true);

    expect(getFeeStatus(feeDetails, 'workshop', null, { customDb: db })).toBe('partial');

    const amounts = extractFeeAmounts(feeDetails, 'workshop', null, { customDb: db });
    expect(amounts.total).toBe(4000);
    expect(amounts.collected).toBe(1500);
    expect(amounts.outstanding).toBe(2500);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 13. Overpayment:
  //     amount_paid=5000 on 4000 fee produces overpayment=1000, remainingDue=0, isPaid=true
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 13: Overpayment (amount_paid=5000 on 4000 fee) resolves to isPaid=true, remainingDue=0, overpayment=1000, status=Paid Full', () => {
    const feeDetails = {
      phases: [
        { status: 'Paid Full', full_fee: 4000, amount_paid: 5000 }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    expect(res.isPaid).toBe(true);
    expect(res.cashCollected).toBe(5000);
    expect(res.remainingDue).toBe(0);
    expect(res.overpayment).toBe(1000);
    expect(res.status).toBe('Paid Full');

    expect(getFeeStatus(feeDetails, 'workshop', null, { customDb: db })).toBe('paid');

    const amounts = extractFeeAmounts(feeDetails, 'workshop', null, { customDb: db });
    expect(amounts.total).toBe(4000);
    expect(amounts.collected).toBe(5000);
    expect(amounts.outstanding).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 14. Partial installments schedule:
  //     3 installments (1000 paid, 1000 pending, 2000 pending)
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 14: Partial installments (1 of 3 paid) resolves to isPaid=false, cashCollected=1000, remainingDue=3000, status=Partial', () => {
    const feeDetails = {
      phases: [
        {
          full_fee: 4000,
          installments: [
            { amount: 1000, status: 'Paid' },
            { amount: 1000, status: 'Pending' },
            { amount: 2000, status: 'Pending' }
          ]
        }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    expect(res.isPaid).toBe(false);
    expect(res.cashCollected).toBe(1000);
    expect(res.remainingDue).toBe(3000);
    expect(res.status).toBe('Partial');

    const amounts = extractFeeAmounts(feeDetails, 'workshop', null, { customDb: db });
    expect(amounts.total).toBe(4000);
    expect(amounts.collected).toBe(1000);
    expect(amounts.outstanding).toBe(3000);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 15. Installment plan whose total is less than net payable:
  //     Installments sum to 2500, all marked Paid, but net payable is 4000
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 15: Installment plan total less than net payable (installments sum to 2500 vs net 4000) leaves 1500 due', () => {
    const feeDetails = {
      phases: [
        {
          full_fee: 4000,
          installments: [
            { amount: 1000, status: 'Paid' },
            { amount: 1500, status: 'Paid' }
          ]
        }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    expect(res.isPaid).toBe(false);
    expect(res.cashCollected).toBe(2500);
    expect(res.remainingDue).toBe(1500);
    expect(res.status).toBe('Partial');

    const amounts = extractFeeAmounts(feeDetails, 'workshop', null, { customDb: db });
    expect(amounts.total).toBe(4000);
    expect(amounts.collected).toBe(2500);
    expect(amounts.outstanding).toBe(1500);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 16. Installment plan whose total is more than net payable:
  //     Gross 4000, discount 1000 -> net payable 3000. Installments total 4000, but student pays 3000 cash.
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 16: Installment plan total more than net payable resolves to isPaid=true when net payable is satisfied', () => {
    const feeDetails = {
      phases: [
        {
          full_fee: 4000,
          discount_amount: 1000,
          installments: [
            { amount: 2000, status: 'Paid' },
            { amount: 1000, status: 'Paid' },
            { amount: 1000, status: 'Pending' }
          ]
        }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    expect(res.grossFee).toBe(4000);
    expect(res.discount).toBe(1000);
    expect(res.netPayable).toBe(3000);
    expect(res.cashCollected).toBe(3000);
    expect(res.remainingDue).toBe(0);
    expect(res.isPaid).toBe(true);
    expect(res.status).toBe('Paid Full');

    expect(getFeeStatus(feeDetails, 'workshop', null, { customDb: db })).toBe('paid');

    const amounts = extractFeeAmounts(feeDetails, 'workshop', null, { customDb: db });
    expect(amounts.total).toBe(4000);
    expect(amounts.discount).toBe(1000);
    expect(amounts.netPayable).toBe(3000);
    expect(amounts.collected).toBe(3000);
    expect(amounts.outstanding).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 17. Mixed installment and direct payments:
  //     direct_payment=500 + installment of 1000 paid on 4000 fee without double counting
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 17: Mixed direct payment (500) and paid installment (1000) reconciles to cashCollected=1500, remainingDue=2500', () => {
    const feeDetails = {
      phases: [
        {
          full_fee: 4000,
          direct_payment: 500,
          installments: [
            { amount: 1000, status: 'Paid' },
            { amount: 2500, status: 'Pending' }
          ]
        }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    expect(res.cashCollected).toBe(1500);
    expect(res.remainingDue).toBe(2500);
    expect(res.isPaid).toBe(false);
    expect(res.status).toBe('Partial');

    const amounts = extractFeeAmounts(feeDetails, 'workshop', null, { customDb: db });
    expect(amounts.total).toBe(4000);
    expect(amounts.collected).toBe(1500);
    expect(amounts.outstanding).toBe(2500);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 18. Full discount (100%):
  //     Discount equals gross fee -> netPayable=0, cashCollected=0, isPaid=true, status='Full Discount'
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 18: Full 100% discount resolves to netPayable=0, cashCollected=0, isPaid=true, status=Full Discount', () => {
    const feeDetails = {
      phases: [
        {
          full_fee: 4000,
          discount: '100%',
          amount_paid: 0
        }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    expect(res.grossFee).toBe(4000);
    expect(res.discount).toBe(4000);
    expect(res.netPayable).toBe(0);
    expect(res.cashCollected).toBe(0);
    expect(res.remainingDue).toBe(0);
    expect(res.isPaid).toBe(true);
    expect(res.status).toBe('Full Discount');

    expect(getFeeStatus(feeDetails, 'workshop', null, { customDb: db })).toBe('paid');

    // Analytics check: cash collected MUST be 0 (discounts are NOT cash collected!)
    const amounts = extractFeeAmounts(feeDetails, 'workshop', null, { customDb: db });
    expect(amounts.total).toBe(4000);
    expect(amounts.discount).toBe(4000);
    expect(amounts.netPayable).toBe(0);
    expect(amounts.collected).toBe(0);
    expect(amounts.outstanding).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 19. Multi-phase re-enrollment discount across 3 phases:
  //     Gross 12,000 (4000/phase), 50% discount -> 2000 net per phase
  //     Phase 1 paid unlocks Phase 2, certificate stays locked until all 3 phases are paid
  //     Analytics reports cash collected = 2000, NOT counting 6000 discount as cash!
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 19: Multi-phase re-enrollment discount across 3 phases unlocks phases incrementally and locks certificate until all phases paid', async () => {
    // 1. Create a 3-phase course definition
    const timestamp = Date.now();
    const uniqueSlug = `multi-phase-discount-${timestamp}`;
    const courseName = `Multi Phase Discount Course ${timestamp}`;

    const defJson = JSON.stringify({
      basics: { name: courseName, type: 'workshop', phaseCount: 3 },
      phases: [
        { id: 'p1_mp', phaseIndex: 1, title: 'Screenplay', feeAmount: 4000, requirements: { completionRequired: true } },
        { id: 'p2_mp', phaseIndex: 2, title: 'Production', feeAmount: 4000, requirements: { completionRequired: true } },
        { id: 'p3_mp', phaseIndex: 3, title: 'Post-Production', feeAmount: 4000, requirements: { completionRequired: true } }
      ],
      completionPolicy: {
        phaseGates: {
          sequentialProgression: true,
          requirePreviousPhasePassed: true,
          requirePreviousPhaseFeesPaid: true
        },
        certificateEligibility: {
          allRequiredPhasesPassed: true,
          requireFeesPaid: true
        }
      }
    });

    const resDef = db.prepare(`
      INSERT INTO course_definitions (
        slug, version, name, course_type, phase_count, status, definition_json, created_by, updated_by
      ) VALUES (?, 1, ?, 'workshop', 3, 'published', ?, 1, 1)
    `).run(uniqueSlug, courseName, defJson);
    const courseDefId = resDef.lastInsertRowid;

    // 2. Student enrolls with a 50% re-enrollment discount applied at course level
    // Initially only Phase 1 is paid (2000 BDT cash)
    const initialFeeDetails = JSON.stringify({
      discount_percentage: 50,
      phases: [
        { full_fee: 4000, amount_paid: 2000, status: 'Paid Full' },
        { full_fee: 4000, amount_paid: 0, status: 'Pending' },
        { full_fee: 4000, amount_paid: 0, status: 'Pending' }
      ]
    });

    const enrRes = db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, course_definition_id, course_version, fee_details
      ) VALUES (?, ?, 'workshop', ?, 1, ?)
    `).run(8, courseName, courseDefId, initialFeeDetails);
    const enrollmentId = enrRes.lastInsertRowid;

    // Mark Phase 1 passed
    db.prepare(`
      INSERT INTO student_phase_results (
        enrollment_id, phase_id, is_passed, attendance_classes, attendance_total, calculated_at
      ) VALUES (?, 'p1_mp', 1, 1, 1, datetime('now'))
    `).run(enrollmentId);

    // 3. Evaluate progress
    const progressP1 = getEnrollmentProgressSync(enrollmentId, db);
    expect(progressP1.phases[0].isFeePaid).toBe(true);
    expect(progressP1.phases[0].feeAmount).toBe(4000);
    expect(progressP1.phases[0].remainingDue).toBe(0);

    // Phase 2 gate check: Phase 1 is paid and passed, so Phase 2 is NOT locked!
    expect(progressP1.phases[1].isLocked).toBe(false);

    // But Phase 2 itself is unpaid (2000 due), Phase 3 is locked, and Certificate is locked!
    expect(progressP1.phases[1].isFeePaid).toBe(false);
    expect(progressP1.phases[1].remainingDue).toBe(2000);
    expect(progressP1.phases[2].isLocked).toBe(true);
    expect(progressP1.certificateEligible).toBe(false);
    expect(progressP1.hasPendingFee).toBe(true);

    // Analytics verification for initial state:
    // Total gross: 12,000; Total discount: 6,000; Net payable: 6,000;
    // Real cash collected: 2,000; Outstanding: 4,000.
    const amountsInitial = extractFeeAmounts(initialFeeDetails, 'workshop', null, { courseDefinition: JSON.parse(defJson), customDb: db });
    expect(amountsInitial.gross).toBe(12000);
    expect(amountsInitial.discount).toBe(6000);
    expect(amountsInitial.netPayable).toBe(6000);
    expect(amountsInitial.collected).toBe(2000);     // NEVER includes discount as cash!
    expect(amountsInitial.outstanding).toBe(4000);

    // 4. Admit to Phase 2 and pay Phase 2 fee (2000 cash) and pass Phase 2
    await admitStudentToPhase(enrollmentId, 2, db);
    const p2PaidFeeDetails = JSON.stringify({
      discount_percentage: 50,
      phases: [
        { full_fee: 4000, amount_paid: 2000, status: 'Paid Full' },
        { full_fee: 4000, amount_paid: 2000, status: 'Paid Full' },
        { full_fee: 4000, amount_paid: 0, status: 'Pending' }
      ]
    });
    db.prepare('UPDATE student_course_enrollments SET fee_details = ? WHERE id = ?').run(
      p2PaidFeeDetails,
      enrollmentId
    );
    db.prepare(`
      INSERT INTO student_phase_results (
        enrollment_id, phase_id, is_passed, attendance_classes, attendance_total, calculated_at
      ) VALUES (?, 'p2_mp', 1, 1, 1, datetime('now'))
      ON CONFLICT(enrollment_id, phase_id) DO UPDATE SET is_passed = 1
    `).run(enrollmentId);

    const progressP2 = getEnrollmentProgressSync(enrollmentId, db);
    expect(progressP2.phases[1].isFeePaid).toBe(true);
    expect(progressP2.phases[2].isLocked).toBe(false); // Phase 3 unlocked!
    expect(progressP2.certificateEligible).toBe(false); // Certificate still locked!

    // 5. Admit to Phase 3, pay Phase 3 fee (2000 cash), pass Phase 3
    await admitStudentToPhase(enrollmentId, 3, db);
    const allPaidFeeDetails = JSON.stringify({
      discount_percentage: 50,
      phases: [
        { full_fee: 4000, amount_paid: 2000, status: 'Paid Full' },
        { full_fee: 4000, amount_paid: 2000, status: 'Paid Full' },
        { full_fee: 4000, amount_paid: 2000, status: 'Paid Full' }
      ]
    });
    db.prepare('UPDATE student_course_enrollments SET fee_details = ? WHERE id = ?').run(
      allPaidFeeDetails,
      enrollmentId
    );
    db.prepare(`
      INSERT INTO student_phase_results (
        enrollment_id, phase_id, is_passed, attendance_classes, attendance_total, calculated_at
      ) VALUES (?, 'p3_mp', 1, 1, 1, datetime('now'))
      ON CONFLICT(enrollment_id, phase_id) DO UPDATE SET is_passed = 1
    `).run(enrollmentId);

    const progressFinal = getEnrollmentProgressSync(enrollmentId, db);
    expect(progressFinal.phases[2].isFeePaid).toBe(true);
    expect(progressFinal.certificateEligible).toBe(true);
    expect(progressFinal.hasPendingFee).toBe(false);

    // Final analytics verification:
    const amountsFinal = extractFeeAmounts(allPaidFeeDetails, 'workshop', null, { courseDefinition: JSON.parse(defJson), customDb: db });
    expect(amountsFinal.gross).toBe(12000);
    expect(amountsFinal.discount).toBe(6000);
    expect(amountsFinal.netPayable).toBe(6000);
    expect(amountsFinal.collected).toBe(6000);
    expect(amountsFinal.outstanding).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 20. Cross-system consensus verification:
  //     Phase gates, admission, certificate lock, student fee display, Fee Tracker,
  //     and Analytics all use the exact same financial result
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 20: Cross-system consensus on underfunded status label (status="Paid Full" with 0 cash)', async () => {
    // Both Phase 1 and 2 pass academically, but Phase 1 has 0 cash despite "Paid Full" label
    const courseDef = {
      basics: { name: 'Consensus Test Course', type: 'workshop', phaseCount: 2 },
      phases: [
        { id: 'p1_c', phaseIndex: 1, title: 'P1', feeAmount: 5000, requirements: { completionRequired: true } },
        { id: 'p2_c', phaseIndex: 2, title: 'P2', feeAmount: 5000, requirements: { completionRequired: true } }
      ],
      completionPolicy: {
        phaseGates: { sequentialProgression: true, requirePreviousPhasePassed: true, requirePreviousPhaseFeesPaid: true },
        certificateEligibility: { allRequiredPhasesPassed: true, requireFeesPaid: true }
      }
    };

    const bogusFeeDetails = {
      phases: [
        { status: 'Paid Full', full_fee: 5000, amount_paid: 0 },
        { status: 'Paid Full', full_fee: 5000, amount_paid: 5000 }
      ]
    };

    // 1. Fee Resolver check
    const p1Fee = resolvePhaseFee({ feeDetailsRaw: bogusFeeDetails, phaseIndex: 0, courseDefinition: courseDef, customDb: db });
    expect(p1Fee.isPaid).toBe(false);
    expect(p1Fee.remainingDue).toBe(5000);
    expect(p1Fee.cashCollected).toBe(0);
    expect(p1Fee.status).toBe('Pending');

    // 2. Fee Status helper check
    const overallFeeStatus = getFeeStatus(bogusFeeDetails, 'workshop', null, { courseDefinition: courseDef, customDb: db });
    expect(overallFeeStatus).toBe('partial'); // Phase 2 has payment, Phase 1 has none, so NOT 'paid'!

    // 3. Analytics / Fee Tracker amounts check
    const amounts = extractFeeAmounts(bogusFeeDetails, 'workshop', null, { courseDefinition: courseDef, customDb: db });
    expect(amounts.total).toBe(10000);
    expect(amounts.collected).toBe(5000);
    expect(amounts.outstanding).toBe(5000);

    // 4. Certificate lock helper check
    const certLocked = hasPendingDueOrPartialPayment(
      JSON.stringify(bogusFeeDetails),
      'workshop',
      'Consensus Test Course',
      null,
      null,
      db,
      null,
      { courseDefinition: courseDef }
    );
    expect(certLocked).toBe(true); // Locked!
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 21. Discounted installment plan remainingDue precision:
  //     remainingDue must always be max(0, netPayable - cashCollected).
  //     gross=4000, discount=1000, cashPaid=1000, unpaid installments=3000
  //     must leave 2000 due, NOT 3000!
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 21: gross=4000, discount=1000, cash paid=1000 with 3000 unpaid installments leaves 2000 due, NOT 3000', () => {
    const feeDetails = {
      phases: [
        {
          full_fee: 4000,
          discount_amount: 1000,
          amount_paid: 1000,
          installments: [
            { amount: 1000, status: 'Paid' },
            { amount: 1000, status: 'Pending' },
            { amount: 2000, status: 'Pending' }
          ]
        }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    // 1. Precise financial metrics
    expect(res.grossFee).toBe(4000);
    expect(res.discount).toBe(1000);
    expect(res.netPayable).toBe(3000);
    expect(res.cashCollected).toBe(1000);
    expect(res.remainingDue).toBe(2000); // CRITICAL: 2000, NOT 3000!
    expect(res.overpayment).toBe(0);
    expect(res.isPaid).toBe(false);
    expect(res.status).toBe('Partial');

    // 2. Accounting Identity:
    // Gross = Discount + Net Payable
    expect(res.grossFee).toBe(res.discount + res.netPayable);
    // Net Payable = Cash Collected + Remaining Due - Overpayment
    expect(res.netPayable).toBe(res.cashCollected + res.remainingDue - res.overpayment);

    // 3. Analytics extraction
    const amounts = extractFeeAmounts(feeDetails, 'workshop', null, { customDb: db });
    expect(amounts.total).toBe(4000);
    expect(amounts.gross).toBe(4000);
    expect(amounts.discount).toBe(1000);
    expect(amounts.netPayable).toBe(3000);
    expect(amounts.collected).toBe(1000);
    expect(amounts.outstanding).toBe(2000);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 22. Overlapping cumulative amount_paid and paid installments:
  //     Deterministic conservative rule: never add amount_paid and instPaidSum
  //     merely because their sum fits under the fee!
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 22: amount_paid=1000 and installment of 1000 paid does NOT double count to 2000', () => {
    // Legacy/ambiguous format where amount_paid holds 1000 and the first installment of 1000 is marked Paid
    const feeDetails = {
      phases: [
        {
          full_fee: 4000,
          amount_paid: 1000,
          installments: [
            { amount: 1000, status: 'Paid' },
            { amount: 3000, status: 'Pending' }
          ]
        }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    // Must NOT double count to 2000!
    expect(res.cashCollected).toBe(1000);
    expect(res.netPayable).toBe(4000);
    expect(res.remainingDue).toBe(3000);
    expect(res.overpayment).toBe(0);

    // Accounting Identity:
    expect(res.grossFee).toBe(res.discount + res.netPayable);
    expect(res.netPayable).toBe(res.cashCollected + res.remainingDue - res.overpayment);

    // Also test cumulative mirror where amount_paid is 2000 and 2 installments of 1000 are paid
    const feeDetails2 = {
      phases: [
        {
          full_fee: 4000,
          amount_paid: 2000,
          installments: [
            { amount: 1000, status: 'Paid' },
            { amount: 1000, status: 'Paid' },
            { amount: 2000, status: 'Pending' }
          ]
        }
      ]
    };
    const res2 = resolvePhaseFee({ feeDetailsRaw: feeDetails2, phaseIndex: 0, customDb: db });
    expect(res2.cashCollected).toBe(2000);
    expect(res2.remainingDue).toBe(2000);
    expect(res2.netPayable).toBe(res2.cashCollected + res2.remainingDue - res2.overpayment);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 23. Explicit separate down payment (direct_payment / down_payment):
  //     Explicitly defined down_payment is separate from installments
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 23: Explicit direct_payment=1000 alongside paid installment=1000 sums to 2000 cash collected', () => {
    const feeDetails = {
      phases: [
        {
          full_fee: 4000,
          direct_payment: 1000,
          installments: [
            { amount: 1000, status: 'Paid' },
            { amount: 2000, status: 'Pending' }
          ]
        }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    expect(res.cashCollected).toBe(2000);
    expect(res.remainingDue).toBe(2000);
    expect(res.overpayment).toBe(0);

    // Accounting Identity:
    expect(res.grossFee).toBe(res.discount + res.netPayable);
    expect(res.netPayable).toBe(res.cashCollected + res.remainingDue - res.overpayment);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 24. Discounted installment plan with overpayment:
  //     gross=5000, discount=1500 -> netPayable=3500. Student pays 4000 cash.
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 24: Discounted plan with overpayment: netPayable = cashCollected + remainingDue - overpayment holds', () => {
    const feeDetails = {
      phases: [
        {
          full_fee: 5000,
          discount_amount: 1500,
          amount_paid: 4000,
          status: 'Paid Full'
        }
      ]
    };

    const res = resolvePhaseFee({
      feeDetailsRaw: feeDetails,
      phaseIndex: 0,
      customDb: db
    });

    expect(res.grossFee).toBe(5000);
    expect(res.discount).toBe(1500);
    expect(res.netPayable).toBe(3500);
    expect(res.cashCollected).toBe(4000);
    expect(res.remainingDue).toBe(0);
    expect(res.overpayment).toBe(500);
    expect(res.isPaid).toBe(true);

    // Accounting Identity verification:
    // 1. Gross = Discount + Net Payable (5000 = 1500 + 3500)
    expect(res.grossFee).toBe(res.discount + res.netPayable);
    // 2. Net Payable = Cash Collected + Remaining Due - Overpayment (3500 = 4000 + 0 - 500)
    expect(res.netPayable).toBe(res.cashCollected + res.remainingDue - res.overpayment);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 25. Multi-phase reconciliation across all operational views:
  //     Phase gates, certificate locks, Student Portal, Fee Tracker, and Analytics
  // ─────────────────────────────────────────────────────────────────────────────
  test('Scenario 25: Multi-phase course accounting identity and cross-view consensus', async () => {
    const timestamp = Date.now();
    const courseDef = {
      basics: { name: `Accounting Multi-Phase ${timestamp}`, type: 'workshop', phaseCount: 3 },
      phases: [
        { id: 'p1_acc', phaseIndex: 1, title: 'Phase 1', feeAmount: 6000, requirements: { completionRequired: true } },
        { id: 'p2_acc', phaseIndex: 2, title: 'Phase 2', feeAmount: 6000, requirements: { completionRequired: true } },
        { id: 'p3_acc', phaseIndex: 3, title: 'Phase 3', feeAmount: 6000, requirements: { completionRequired: true } }
      ],
      completionPolicy: {
        phaseGates: { sequentialProgression: true, requirePreviousPhasePassed: true, requirePreviousPhaseFeesPaid: true },
        certificateEligibility: { allRequiredPhasesPassed: true, requireFeesPaid: true }
      }
    };

    // Course definition row
    const defStmt = db.prepare(`
      INSERT INTO course_definitions (
        slug, version, name, course_type, phase_count, status, definition_json, created_by, updated_by
      ) VALUES (?, 1, ?, 'workshop', 3, 'published', ?, 1, 1)
    `);
    const defRes = defStmt.run(`acc-multi-${timestamp}`, `Accounting Multi-Phase ${timestamp}`, JSON.stringify(courseDef));
    const courseDefId = defRes.lastInsertRowid;

    // Student has 50% discount:
    // Phase 1: 6000 gross, 3000 discount, 3000 net payable, 3000 paid in cash -> fully paid!
    // Phase 2: 6000 gross, 3000 discount, 3000 net payable, 1000 paid in cash -> 2000 remaining due!
    // Phase 3: 6000 gross, 3000 discount, 3000 net payable, 0 paid in cash -> 3000 remaining due!
    const feeDetails = {
      discount_percentage: 50,
      phases: [
        { full_fee: 6000, amount_paid: 3000, status: 'Paid Full' },
        { full_fee: 6000, amount_paid: 1000, status: 'Partial' },
        { full_fee: 6000, amount_paid: 0, status: 'Pending' }
      ]
    };

    // Enrollment
    const enrRes = db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, course_definition_id, course_version, fee_details
      ) VALUES (?, ?, 'workshop', ?, 1, ?)
    `).run(8, `Accounting Multi-Phase ${timestamp}`, courseDefId, JSON.stringify(feeDetails));
    const enrollmentId = enrRes.lastInsertRowid;

    // Verify accounting identity for each phase
    for (let p = 0; p < 3; p++) {
      const pRes = resolvePhaseFee({
        feeDetailsRaw: feeDetails,
        phaseIndex: p,
        courseDefinition: courseDef,
        customDb: db
      });
      // Gross = Discount + Net Payable
      expect(pRes.grossFee).toBe(pRes.discount + pRes.netPayable);
      // Net Payable = Cash Collected + Remaining Due - Overpayment
      expect(pRes.netPayable).toBe(pRes.cashCollected + pRes.remainingDue - pRes.overpayment);
    }

    // Phase 1 check:
    const p1Res = resolvePhaseFee({ feeDetailsRaw: feeDetails, phaseIndex: 0, courseDefinition: courseDef, customDb: db });
    expect(p1Res.isPaid).toBe(true);
    expect(p1Res.remainingDue).toBe(0);

    // Phase 2 check:
    const p2Res = resolvePhaseFee({ feeDetailsRaw: feeDetails, phaseIndex: 1, courseDefinition: courseDef, customDb: db });
    expect(p2Res.isPaid).toBe(false);
    expect(p2Res.remainingDue).toBe(2000);

    // Phase 3 check:
    const p3Res = resolvePhaseFee({ feeDetailsRaw: feeDetails, phaseIndex: 2, courseDefinition: courseDef, customDb: db });
    expect(p3Res.isPaid).toBe(false);
    expect(p3Res.remainingDue).toBe(3000);

    // Aggregate Analytics extraction check:
    // Total Gross = 18,000; Total Discount = 9,000; Total Net Payable = 9,000;
    // Total Cash Collected = 4,000 (3000 + 1000); Total Outstanding = 5,000 (2000 + 3000).
    const amounts = extractFeeAmounts(feeDetails, 'workshop', null, { courseDefinition: courseDef, customDb: db });
    expect(amounts.gross).toBe(18000);
    expect(amounts.discount).toBe(9000);
    expect(amounts.netPayable).toBe(9000);
    expect(amounts.collected).toBe(4000);     // NEVER includes discount as cash!
    expect(amounts.outstanding).toBe(5000);
    expect(amounts.gross).toBe(amounts.discount + amounts.netPayable);
    expect(amounts.netPayable).toBe(amounts.collected + amounts.outstanding);

    // Mark Phase 1 passed
    db.prepare(`
      INSERT INTO student_phase_results (
        enrollment_id, phase_id, is_passed, attendance_classes, attendance_total, calculated_at
      ) VALUES (?, 'p1_acc', 1, 1, 1, datetime('now'))
    `).run(enrollmentId);

    // Progress evaluation:
    const progress = getEnrollmentProgressSync(enrollmentId, db);
    expect(progress.phases[0].isFeePaid).toBe(true);
    expect(progress.phases[1].isLocked).toBe(false); // Phase 2 unlocked because Phase 1 fee is paid
    expect(progress.phases[1].isFeePaid).toBe(false);
    expect(progress.phases[1].remainingDue).toBe(2000);
    expect(progress.hasPendingFee).toBe(true);
    expect(progress.certificateEligible).toBe(false); // Locked because Phase 2 and 3 fees remain due

    // Certificate helper check:
    const certLocked = hasPendingDueOrPartialPayment(
      JSON.stringify(feeDetails),
      'workshop',
      `Accounting Multi-Phase ${timestamp}`,
      null,
      courseDefId,
      db,
      { course_definition_id: courseDefId, fee_details: JSON.stringify(feeDetails) }
    );
    expect(certLocked).toBe(true);
  });
});
