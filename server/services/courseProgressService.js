import defaultDb from '../db/database.js';
import { resolvePhaseFee } from '../utils/feeResolver.js';

/**
 * Course Progress Engine & Dual-Model Evaluation Service
 * 
 * Provides an authoritative separation between legacy 2-phase courses
 * (course_definition_id IS NULL) and defined 1–5 phase courses (course_definition_id IS NOT NULL).
 * Avoids lossy dual-writes to legacy columns, and uses atomic relational updates
 * for attendance and assignment grades to prevent JSON concurrency race conditions.
 */

function getDatabase(customDb) {
  return customDb || defaultDb;
}

/**
 * Resolve the operational routine for a phase using a 3-tier precedence hierarchy:
 * 1. Batch-specific override (batch_id = batchId)
 * 2. Course-level override (batch_id = 0 or NULL)
 * 3. Published definition baseline routine
 */
export function resolvePhaseRoutine(db, courseDefinitionId, batchId, phaseId, baseRoutine = []) {
  if (batchId) {
    const batchOverride = db.prepare(`
      SELECT routine_json FROM course_routine_overrides
      WHERE course_definition_id = ? AND batch_id = ? AND phase_id = ?
    `).get(courseDefinitionId, batchId, phaseId);
    if (batchOverride?.routine_json) {
      try {
        return { routine: JSON.parse(batchOverride.routine_json), source: 'batch_override' };
      } catch { /* empty */ }
    }
  }

  const courseOverride = db.prepare(`
    SELECT routine_json FROM course_routine_overrides
    WHERE course_definition_id = ? AND (batch_id = 0 OR batch_id IS NULL) AND phase_id = ?
  `).get(courseDefinitionId, phaseId);
  if (courseOverride?.routine_json) {
    try {
      return { routine: JSON.parse(courseOverride.routine_json), source: 'course_override' };
    } catch { /* empty */ }
  }

  return { routine: baseRoutine || [], source: 'definition_baseline' };
}

/**
 * Check if a specific phase fee is paid in fee_details
 * Delegates to the authoritative resolvePhaseFee utility.
 */
export function isPhaseFeePaid(feeDetailsRaw, phaseIndex, options = {}) {
  const feeRes = resolvePhaseFee({
    feeDetailsRaw,
    phaseIndex,
    enrollment: options.enrollment,
    courseDefinition: options.courseDefinition,
    courseDefId: options.courseDefId,
    courseName: options.courseName,
    courseType: options.courseType,
    batchNumber: options.batchNumber,
    batchId: options.batchId,
    customDb: options.customDb || options.db
  });
  return feeRes.isPaid;
}

/**
 * Check if a phase has any recorded payment (amount_paid > 0 or partial/paid status)
 * Used to strictly enforce payment restrictions (e.g. cannot undo phase admission after payment).
 */
export function hasPhasePaymentRecorded(feeDetailsRaw, phaseNumber, options = {}) {
  const phaseIndex = phaseNumber - 1;
  const feeRes = resolvePhaseFee({
    feeDetailsRaw,
    phaseIndex,
    enrollment: options.enrollment,
    courseDefinition: options.courseDefinition,
    courseDefId: options.courseDefId,
    courseName: options.courseName,
    courseType: options.courseType,
    batchNumber: options.batchNumber,
    batchId: options.batchId,
    customDb: options.customDb || options.db
  });
  return feeRes.hasPayment;
}

/**
 * Evaluate pass/fail for a given phase
 */
function evaluatePhasePass({ phase, attendance, classes, assignments, examMarks }) {
  const req = phase.requirements || {};

  // 1. Attendance check
  let attendanceMet = true;
  if (req.attendanceRequired) {
    const minPercent = req.minAttendancePercent || 0;
    attendanceMet = attendance.percentage >= minPercent;
  }

  // 2. Mandatory classes check
  let mandatoryClassesMet = true;
  if (req.completionRequired !== false) {
    const mandatoryClasses = classes.filter(c => c.mandatory);
    if (mandatoryClasses.length > 0) {
      mandatoryClassesMet = mandatoryClasses.every(c => c.attended);
    }
  }

  // 3. Category requirements check (e.g. practical/shooting/editing minimum attendance)
  let categoryRequirementsMet = true;
  if (req.categoryRequirements && typeof req.categoryRequirements === 'object') {
    for (const [catName, catRule] of Object.entries(req.categoryRequirements)) {
      const minRequired = typeof catRule === 'number' ? catRule : (catRule.minAttended || 1);
      const attendedCount = classes.filter(c => (c.category || 'theory') === catName && c.attended).length;
      if (attendedCount < minRequired) {
        categoryRequirementsMet = false;
        break;
      }
    }
  }

  // 4. Assignments check
  let assignmentsMet = true;
  if (req.completionRequired && assignments.length > 0) {
    const requiredAssignments = assignments.filter(a => a.submissionRequired || (a.passMarks && a.passMarks > 0));
    if (requiredAssignments.length > 0) {
      assignmentsMet = requiredAssignments.every(a => a.isPassed);
    }
  }

  // 5. Exam check
  let examMet = true;
  if (phase.exam && phase.exam.enabled) {
    if (examMarks === null || examMarks === undefined) {
      examMet = false;
    } else {
      const minExamPass = phase.exam.passMarks || 0;
      if (examMarks < minExamPass) {
        examMet = false;
      } else if (phase.exam.phasePassThreshold) {
        let total = examMarks;
        if (phase.exam.includeAssignmentsInTotal !== false) {
          const totalAssignmentMarks = assignments.reduce((acc, a) => acc + (a.marksObtained !== null && a.marksObtained !== undefined ? a.marksObtained : 0), 0);
          total += totalAssignmentMarks;
        }
        if (total < phase.exam.phasePassThreshold) {
          examMet = false;
        }
      }
    }
  }

  return attendanceMet && mandatoryClassesMet && categoryRequirementsMet && assignmentsMet && examMet;
}

/**
 * Synchronous core calculation of complete progress for any enrollment (legacy or defined)
 * @param {number} enrollmentId - ID from student_course_enrollments
 * @param {object|null} customDb - Optional custom db instance
 * @param {object} options - Optional context, e.g. { batchId }
 */
export function getEnrollmentProgressSync(enrollmentId, customDb = null, options = {}) {
  const db = getDatabase(customDb);
  const enrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ?').get(enrollmentId);

  if (!enrollment) {
    return null;
  }

  // ── Authoritative Path A: Legacy Enrollment (course_definition_id IS NULL) ──
  if (!enrollment.course_definition_id) {
    const failedAnyPhase = (enrollment.exam_written !== null && enrollment.exam_written !== undefined && Number(enrollment.exam_written) < 40);
    return {
      enrollmentId: enrollment.id,
      userId: enrollment.user_id,
      courseName: enrollment.course_name,
      courseType: enrollment.course_type,
      batchId: enrollment.batch_id || null,
      isLegacy: true,
      course_definition_id: null,
      course_version: null,
      legacy: {
        step1_completed: enrollment.step1_completed || 0,
        step2_completed: enrollment.step2_completed || 0,
        step3_completed: enrollment.step3_completed || 0,
        step4_completed: enrollment.step4_completed || 0,
        attendance_classes: enrollment.attendance_classes || 0,
        attendance_total: enrollment.attendance_total || 0,
        exam_written: enrollment.exam_written,
        assignment_scores: enrollment.assignment_scores
      },
      certificateEligible: enrollment.step4_completed === 1,
      failedAnyPhase
    };
  }

  // ── Authoritative Path B: Defined Course Enrollment (1–5 Phases) ──
  const courseDefRow = db.prepare('SELECT * FROM course_definitions WHERE id = ?').get(enrollment.course_definition_id);
  if (!courseDefRow) {
    throw new Error(`Course definition ${enrollment.course_definition_id} not found for enrollment ${enrollmentId}`);
  }

  let definition;
  try {
    definition = JSON.parse(courseDefRow.definition_json);
  } catch (err) {
    throw new Error(`Failed to parse definition_json for course definition ${courseDefRow.id}: ${err.message}`);
  }

  // Fetch student atomic records
  const attendanceRows = db.prepare('SELECT * FROM student_class_attendance WHERE enrollment_id = ?').all(enrollmentId);
  const attMap = new Map(attendanceRows.map(r => [r.class_id, r]));

  const gradeRows = db.prepare('SELECT * FROM student_assignment_grades WHERE enrollment_id = ?').all(enrollmentId);
  const gradeMap = new Map(gradeRows.map(r => [r.assignment_id, r]));

  const phaseResultRows = db.prepare('SELECT * FROM student_phase_results WHERE enrollment_id = ?').all(enrollmentId);
  const phaseResultMap = new Map(phaseResultRows.map(r => [r.phase_id, r]));

  // Check if enrollment was explicitly migrated from legacy
  const migrationRecord = db.prepare('SELECT * FROM legacy_enrollment_migrations WHERE enrollment_id = ?').get(enrollmentId);
  let legacySnapshot = null;
  if (migrationRecord?.legacy_snapshot_json) {
    try {
      legacySnapshot = JSON.parse(migrationRecord.legacy_snapshot_json);
    } catch { /* empty */ }
  }

  // ── Explicit & Deterministic Batch Resolution ──────────────────────────────
  // 1. Caller-supplied explicit batch context (options.batchId)
  // 2. Direct enrollment-to-batch link (student_course_enrollments.batch_id)
  // 3. Fallback: single unambiguous matching batch in batch_students
  // If multiple matching batches exist and no explicit context is provided,
  // do NOT silently choose an arbitrary batch with LIMIT 1.
  let studentBatchId = null;
  let ambiguousBatch = false;
  let matchingBatchIds = [];

  if (options && options.batchId) {
    const contextBatch = db.prepare('SELECT id, course_definition_id FROM batches WHERE id = ?').get(options.batchId);
    if (contextBatch && (!contextBatch.course_definition_id || contextBatch.course_definition_id === enrollment.course_definition_id)) {
      studentBatchId = contextBatch.id;
    }
  } else if (enrollment.batch_id) {
    studentBatchId = enrollment.batch_id;
  } else {
    const matchingBatches = db.prepare(`
      SELECT b.id as batch_id, b.batch_name
      FROM batch_students bs
      JOIN batches b ON b.id = bs.batch_id
      WHERE bs.student_id = ? AND b.course_definition_id = ?
    `).all(enrollment.user_id, enrollment.course_definition_id);

    if (matchingBatches.length === 1) {
      studentBatchId = matchingBatches[0].batch_id;
      // Self-heal: backfill explicit link on enrollment
      try {
        db.prepare('UPDATE student_course_enrollments SET batch_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(studentBatchId, enrollment.id);
      } catch { /* empty */ }
    } else if (matchingBatches.length > 1) {
      ambiguousBatch = true;
      matchingBatchIds = matchingBatches.map(b => b.batch_id);
      studentBatchId = null;
    }
  }

  const policy = definition.completionPolicy || {};
  const phaseGates = policy.phaseGates || policy.phaseProgression || {};
  const sequentialProgression = phaseGates.sequentialProgression !== false;
  const requirePreviousPhasePassed = phaseGates.requirePreviousPhasePassed !== false;
  const requirePreviousPhaseFeesPaid = !!phaseGates.requirePreviousPhaseFeesPaid;

  let totalClassesAllPhases = 0;
  let totalAttendedAllPhases = 0;
  let allRequiredPhasesPassed = true;
  let allMandatoryClassesMet = true;
  let allMandatoryAssignmentsMet = true;

  const evaluatedPhases = [];
  for (let idx = 0; idx < (definition.phases || []).length; idx++) {
    const phase = definition.phases[idx];
    const phaseId = phase.id || `p_${idx + 1}`;
    const resolvedRoutine = resolvePhaseRoutine(db, enrollment.course_definition_id, studentBatchId, phaseId, phase.routine);

    // Evaluate classes
    const classes = (phase.classes || []).map(cls => {
      const att = attMap.get(cls.id);
      const attended = att ? att.attended === 1 : false;
      return {
        id: cls.id,
        title: cls.title,
        subjectId: cls.subjectId,
        subjectName: cls.subjectName,
        teacherId: cls.teacherId,
        teacherName: cls.teacherName,
        deliveryMode: cls.deliveryMode,
        category: cls.category,
        durationMinutes: cls.durationMinutes,
        mandatory: cls.mandatory !== false,
        attended,
        attendedAt: att ? att.attended_at : null
      };
    });

    const totalClasses = classes.length > 0 ? classes.length : (phase.classCount || 0);
    const attendedClasses = classes.filter(c => c.attended).length;
    const attendancePercentage = totalClasses > 0 ? Math.round((attendedClasses / totalClasses) * 100) : 100;

    totalClassesAllPhases += totalClasses;
    totalAttendedAllPhases += attendedClasses;

    // Category Breakdown Calculation
    const categoryStats = {};
    for (const cls of classes) {
      const cat = cls.category || 'theory';
      if (!categoryStats[cat]) {
        categoryStats[cat] = { total: 0, attended: 0, mandatoryTotal: 0, mandatoryAttended: 0 };
      }
      categoryStats[cat].total++;
      if (cls.attended) categoryStats[cat].attended++;
      if (cls.mandatory) {
        categoryStats[cat].mandatoryTotal++;
        if (cls.attended) categoryStats[cat].mandatoryAttended++;
      }
    }

    // Evaluate assignments
    const assignments = (phase.assignments || []).map(asg => {
      const g = gradeMap.get(asg.id);
      const marksObtained = (g && g.marks_obtained !== null && g.marks_obtained !== undefined)
        ? Number(g.marks_obtained)
        : null;
      const passMarks = asg.passMarks || 0;
      const isGraded = marksObtained !== null;
      const isPassed = isGraded ? marksObtained >= passMarks : false;
      return {
        id: asg.id,
        title: asg.title,
        subject: asg.subject,
        instructions: asg.instructions,
        submissionRequired: asg.submissionRequired !== false,
        maxMarks: asg.maxMarks,
        passMarks,
        marksObtained,
        isGraded,
        submissionStatus: g ? g.submission_status : 'pending',
        remarks: g ? g.remarks : null,
        gradedAt: g ? g.graded_at : null,
        isPassed
      };
    });

    // Evaluate exam
    const phaseResult = phaseResultMap.get(phaseId);
    const examMarks = (phaseResult && phaseResult.exam_marks !== null && phaseResult.exam_marks !== undefined)
      ? phaseResult.exam_marks
      : null;

    const exam = {
      enabled: !!(phase.exam && phase.exam.enabled),
      title: phase.exam?.title || 'Phase Exam',
      type: phase.exam?.type || 'written',
      maxMarks: phase.exam?.maxMarks || 100,
      passMarks: phase.exam?.passMarks || 40,
      phasePassThreshold: phase.exam?.phasePassThreshold,
      includeAssignmentsInTotal: phase.exam?.includeAssignmentsInTotal,
      marksObtained: examMarks,
      isPassed: phase.exam?.enabled
        ? (examMarks !== null && examMarks >= (phase.exam?.passMarks || 0))
        : true
    };

    // If this student was explicitly migrated from legacy and student_phase_results recorded is_passed = 1,
    // preserve the historical pass result!
    const isMigratedPhase = !!(migrationRecord && phaseResult && phaseResult.is_passed === 1);

    // Evaluate phase gating
    let isLocked = false;
    let lockReason = null;
    if (idx > 0 && sequentialProgression && !isMigratedPhase) {
      const prevPhase = evaluatedPhases[idx - 1];
      if (requirePreviousPhasePassed && prevPhase && !prevPhase.isPassed) {
        isLocked = true;
        lockReason = `Phase ${idx} must be passed before advancing to Phase ${idx + 1}.`;
      } else if (requirePreviousPhaseFeesPaid) {
        const prevFeeRes = resolvePhaseFee({
          feeDetailsRaw: enrollment.fee_details,
          phaseIndex: idx - 1,
          enrollment,
          courseDefinition: definition,
          batchId: studentBatchId,
          customDb: db
        });
        if (!prevFeeRes.isPaid) {
          isLocked = true;
          lockReason = `Phase ${idx} fees must be fully paid before advancing to Phase ${idx + 1}.`;
        }
      }
    }

    let isPhaseAdmitted = false;
    if (idx === 0) {
      isPhaseAdmitted = true;
    } else if (isMigratedPhase) {
      isPhaseAdmitted = true;
    } else if (migrationRecord && idx === 1 && (migrationRecord.step3_completed === 1 || migrationRecord.step4_completed === 1)) {
      isPhaseAdmitted = true;
    } else if (phaseResult && phaseResult.admitted !== undefined && phaseResult.admitted !== null) {
      isPhaseAdmitted = (phaseResult.admitted === 1);
    } else {
      isPhaseAdmitted = false;
    }

    let isPassed = false;
    if (isMigratedPhase) {
      isPassed = true;
    } else if (isLocked || (idx > 0 && !isPhaseAdmitted)) {
      isPassed = false;
    } else {
      isPassed = evaluatePhasePass({
        phase,
        attendance: { attendedClasses, totalClasses, percentage: attendancePercentage },
        classes,
        assignments,
        examMarks
      });
    }

    let status = 'in_progress';
    if (isMigratedPhase || isPassed) {
      status = 'passed';
    } else if (examMarks !== null && !exam.isPassed) {
      status = 'failed';
    } else if (isLocked) {
      status = 'locked';
    } else if (idx > 0 && !isPhaseAdmitted) {
      status = 'pending_admission';
    }

    const effectiveAttendancePercentage = isMigratedPhase && phaseResult?.attendance_percentage !== null && phaseResult?.attendance_percentage !== undefined
      ? phaseResult.attendance_percentage
      : attendancePercentage;

    const isPhaseRequired = phase.requirements?.completionRequired !== false;
    if (isPhaseRequired && !isPassed) {
      allRequiredPhasesPassed = false;
    }

    if (!isMigratedPhase && classes.some(c => c.mandatory && !c.attended)) {
      allMandatoryClassesMet = false;
    }

    if (!isMigratedPhase && assignments.some(a => a.submissionRequired && !a.isPassed)) {
      allMandatoryAssignmentsMet = false;
    }

    assignments.totalCount = assignments.length;
    assignments.submittedCount = assignments.filter(a => a.submissionStatus === 'submitted' || a.marksObtained > 0 || a.isPassed).length;
    assignments.totalMarks = assignments.reduce((acc, a) => acc + (a.marksObtained || 0), 0);
    assignments.maxPossibleMarks = assignments.reduce((acc, a) => acc + (a.maxMarks || 0), 0);
    assignments.passMarks = assignments.reduce((acc, a) => acc + (a.passMarks || 0), 0);
    assignments.satisfied = assignments.length === 0 || assignments.filter(a => a.submissionRequired || a.passMarks > 0).every(a => a.isPassed);

    const minAttReq = phase.requirements?.minAttendancePercent || 0;
    const attSatisfied = isMigratedPhase || (effectiveAttendancePercentage >= minAttReq);
    const attendedCount = isMigratedPhase && phaseResult?.attendance_classes !== null && phaseResult?.attendance_classes !== undefined ? phaseResult.attendance_classes : attendedClasses;
    const totalCount = isMigratedPhase && phaseResult?.attendance_total !== null && phaseResult?.attendance_total !== undefined ? phaseResult.attendance_total : totalClasses;

    const phaseFeeRes = resolvePhaseFee({
      feeDetailsRaw: enrollment.fee_details,
      phaseIndex: idx,
      enrollment,
      courseDefinition: definition,
      batchId: studentBatchId,
      customDb: db
    });

    evaluatedPhases.push({
      id: phaseId,
      phaseIndex: phase.phaseIndex || (idx + 1),
      phaseNumber: phase.phaseIndex || (idx + 1),
      title: phase.title,
      phaseName: phase.title,
      description: phase.description,
      duration: phase.duration,
      requirements: phase.requirements,
      categoryStats,
      isLocked,
      lockReason,
      isAdmitted: isPhaseAdmitted,
      admittedAt: phaseResult?.admitted_at || null,
      feeAmount: phaseFeeRes.expectedFee,
      feeStatus: phaseFeeRes.status,
      amountPaid: phaseFeeRes.amountPaid,
      discountAmount: phaseFeeRes.discountAmount,
      remainingDue: phaseFeeRes.remainingDue,
      isFree: phaseFeeRes.isFree,
      isMissingRecord: phaseFeeRes.isMissingRecord,
      hasPayment: phaseFeeRes.hasPayment,
      isFeePaid: phaseFeeRes.isPaid,
      routine: resolvedRoutine.routine,
      routineSource: resolvedRoutine.source,
      isMigrated: isMigratedPhase,
      status,
      attendance: {
        attended: attendedCount,
        attendedClasses: attendedCount,
        total: totalCount,
        totalClasses: totalCount,
        percentage: effectiveAttendancePercentage,
        requiredPercentage: minAttReq,
        satisfied: attSatisfied
      },
      classes,
      assignments,
      exam: {
        ...exam,
        taken: examMarks !== null && examMarks !== undefined,
        score: examMarks,
        satisfied: exam.isPassed
      },
      isPassed
    });
  }

  // Evaluate overall certificate eligibility based on completionPolicy
  const certPolicy = policy.certificateEligibility || {};

  let certificateEligible = true;
  // If the student was an explicitly migrated legacy graduate who completed Phase 2 (step4_completed = 1),
  // preserve certificate eligibility unconditionally!
  if (legacySnapshot && legacySnapshot.step4_completed === 1) {
    certificateEligible = true;
  } else {
    if (certPolicy.allRequiredPhasesPassed !== false && !allRequiredPhasesPassed) {
      certificateEligible = false;
    }
    if (certPolicy.minOverallAttendance) {
      const overallAttendance = totalClassesAllPhases > 0
        ? Math.round((totalAttendedAllPhases / totalClassesAllPhases) * 100)
        : 100;
      if (overallAttendance < certPolicy.minOverallAttendance) {
        certificateEligible = false;
      }
    }
    if (certPolicy.requireAllMandatoryClasses && !allMandatoryClassesMet) {
      certificateEligible = false;
    }
    if (certPolicy.requireAllMandatoryAssignments && !allMandatoryAssignmentsMet) {
      certificateEligible = false;
    }
    if (certPolicy.requireFeesPaid) {
      for (let pIdx = 0; pIdx < (definition.phases || []).length; pIdx++) {
        const pFeeRes = resolvePhaseFee({
          feeDetailsRaw: enrollment.fee_details,
          phaseIndex: pIdx,
          enrollment,
          courseDefinition: definition,
          batchId: studentBatchId,
          customDb: db
        });
        if (!pFeeRes.isPaid) {
          certificateEligible = false;
          break;
        }
      }
    }
  }

  const reEnrollment = policy.reEnrollment || {};
  const reEnrollmentDiscountPercentage = reEnrollment.discountEnabled
    ? (reEnrollment.discountPercentage !== undefined ? reEnrollment.discountPercentage : 50)
    : 0;

  // An enrollment is only considered failed if an actual failed outcome occurred
  // (e.g. failed exam score, disqualified attendance, or explicit failure), NOT merely in-progress.
  const anyFailed = evaluatedPhases.some(p => p.status === 'failed');
  const hasPendingFee = evaluatedPhases.some(p => !p.isFeePaid || (p.remainingDue && p.remainingDue > 0));

  return {
    enrollmentId: enrollment.id,
    userId: enrollment.user_id,
    courseName: enrollment.course_name,
    courseType: enrollment.course_type,
    course_definition_id: enrollment.course_definition_id,
    course_version: enrollment.course_version,
    courseVersion: enrollment.course_version,
    batchId: studentBatchId,
    ambiguousBatch,
    matchingBatchIds,
    phaseCount: (definition.phases || []).length,
    isLegacy: false,
    isMigrated: !!migrationRecord,
    migrationDetails: migrationRecord ? {
      sourceCourseName: migrationRecord.source_course_name,
      migratedAt: migrationRecord.migrated_at,
      notes: migrationRecord.notes
    } : null,
    phases: evaluatedPhases,
    certificateEligible,
    hasPendingFee,
    failedAnyPhase: anyFailed,
    reEnrollmentDiscount: (reEnrollment.discountEnabled && anyFailed) ? {
      percent: reEnrollmentDiscountPercentage,
      description: reEnrollment.discountDescription || 'Re-enrollment discount'
    } : null,
    completionPolicy: {
      ...policy,
      phaseGates: {
        sequentialProgression,
        requirePreviousPhasePassed,
        requirePreviousPhaseFeesPaid
      },
      reEnrollment: {
        ...reEnrollment,
        discountPercentage: reEnrollmentDiscountPercentage
      }
    }
  };
}

/**
 * Async wrapper for getEnrollmentProgressSync
 */
export async function getEnrollmentProgress(enrollmentId, customDb = null, options = {}) {
  return getEnrollmentProgressSync(enrollmentId, customDb, options);
}

/**
 * Internal helper to sync `student_phase_results` cache table
 */
function syncPhaseResults(enrollmentId, phases, db, options = {}) {
  const upsertStmt = db.prepare(`
    INSERT INTO student_phase_results (
      enrollment_id, phase_id, attendance_classes, attendance_total, attendance_percentage,
      assignments_completed, assignments_total, exam_marks, is_passed, admitted, admitted_at, calculated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(enrollment_id, phase_id) DO UPDATE SET
      attendance_classes = excluded.attendance_classes,
      attendance_total = excluded.attendance_total,
      attendance_percentage = excluded.attendance_percentage,
      assignments_completed = excluded.assignments_completed,
      assignments_total = excluded.assignments_total,
      exam_marks = excluded.exam_marks,
      is_passed = excluded.is_passed,
      calculated_at = excluded.calculated_at
  `);

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (options && options.failureInjectionInSync && i === phases.length - 1) {
      throw new Error('Injected failure inside phase-summary synchronization for testing rollback');
    }
    const completedAssignments = p.assignments.filter(a => a.isPassed).length;
    const isAdmitted = i === 0 || !!p.isAdmitted;
    const admittedVal = isAdmitted ? 1 : 0;
    const admittedAtVal = isAdmitted ? (p.admittedAt || new Date().toISOString()) : null;

    upsertStmt.run(
      enrollmentId,
      p.id,
      p.attendance.attendedClasses,
      p.attendance.totalClasses,
      p.attendance.percentage,
      completedAssignments,
      p.assignments.length,
      p.exam?.marksObtained !== undefined ? p.exam.marksObtained : null,
      p.isPassed ? 1 : 0,
      admittedVal,
      admittedAtVal
    );
  }
}

/**
 * Record atomic class attendance for a student
 */
export async function recordClassAttendance(enrollmentId, classId, attended, updatedBy = null, customDb = null, options = {}) {
  const db = getDatabase(customDb);

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO student_class_attendance (
        enrollment_id, class_id, attended, attended_at, updated_by
      ) VALUES (?, ?, ?, datetime('now', 'localtime'), ?)
      ON CONFLICT(enrollment_id, class_id) DO UPDATE SET
        attended = excluded.attended,
        attended_at = excluded.attended_at,
        updated_by = excluded.updated_by
    `).run(enrollmentId, classId, attended ? 1 : 0, updatedBy);

    if (options && options.failureInjection) {
      throw new Error('Injected failure inside atomic transaction for testing rollback');
    }

    // Recalculate phases and sync student_phase_results inside the same atomic transaction
    const progress = getEnrollmentProgressSync(enrollmentId, db, options);
    if (progress && !progress.isLegacy) {
      syncPhaseResults(enrollmentId, progress.phases, db, options);
    }
    return progress;
  });

  return tx();
}

/**
 * Record atomic assignment grade for a student
 */
export async function recordAssignmentGrade(enrollmentId, assignmentId, marks, status = 'graded', remarks = null, gradedBy = null, customDb = null, options = {}) {
  const db = getDatabase(customDb);
  const marksVal = (marks !== null && marks !== undefined && marks !== '') ? Number(marks) : null;

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO student_assignment_grades (
        enrollment_id, assignment_id, marks_obtained, submission_status, remarks, graded_by, graded_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(enrollment_id, assignment_id) DO UPDATE SET
        marks_obtained = excluded.marks_obtained,
        submission_status = excluded.submission_status,
        remarks = excluded.remarks,
        graded_by = excluded.graded_by,
        graded_at = excluded.graded_at
    `).run(enrollmentId, assignmentId, marksVal, status, remarks, gradedBy);

    if (options && options.failureInjection) {
      throw new Error('Injected failure inside atomic transaction for testing rollback');
    }

    // Recalculate phases and sync student_phase_results inside the same atomic transaction
    const progress = getEnrollmentProgressSync(enrollmentId, db, options);
    if (progress && !progress.isLegacy) {
      syncPhaseResults(enrollmentId, progress.phases, db, options);
    }
    return progress;
  });

  return tx();
}

/**
 * Record atomic exam marks for a phase
 */
export async function recordExamMarks(enrollmentId, phaseId, marks, customDb = null, options = {}) {
  const db = getDatabase(customDb);
  const marksVal = (marks !== null && marks !== undefined && marks !== '') ? Number(marks) : null;

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO student_phase_results (
        enrollment_id, phase_id, exam_marks, calculated_at
      ) VALUES (?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(enrollment_id, phase_id) DO UPDATE SET
        exam_marks = excluded.exam_marks,
        calculated_at = excluded.calculated_at
    `).run(enrollmentId, phaseId, marksVal);

    if (options && options.failureInjection) {
      throw new Error('Injected failure inside atomic transaction for testing rollback');
    }

    // Recalculate phases and sync student_phase_results inside the same atomic transaction
    const progress = getEnrollmentProgressSync(enrollmentId, db, options);
    if (progress && !progress.isLegacy) {
      syncPhaseResults(enrollmentId, progress.phases, db, options);
    }
    return progress;
  });

  return tx();
}

/**
 * Execute atomic batch update of attendance, assignments, and exams for a defined course enrollment.
 * Executes all updates, failure injection check, progress calculation, and phase results synchronization
 * inside a single synchronous SQLite transaction, guaranteeing all-or-nothing rollback.
 */
export async function updateDefinedProgressAtomic(enrollmentId, payload, customDb = null, options = {}) {
  const db = getDatabase(customDb);
  const { attendance, assignments, exam_marks, updatedBy = null } = payload;

  const tx = db.transaction(() => {
    // 1. Attendance updates
    if (Array.isArray(attendance) && attendance.length > 0) {
      const attStmt = db.prepare(`
        INSERT INTO student_class_attendance (
          enrollment_id, class_id, attended, attended_at, updated_by
        ) VALUES (?, ?, ?, datetime('now', 'localtime'), ?)
        ON CONFLICT(enrollment_id, class_id) DO UPDATE SET
          attended = excluded.attended,
          attended_at = excluded.attended_at,
          updated_by = excluded.updated_by
      `);
      for (const item of attendance) {
        if (item.class_id) {
          attStmt.run(enrollmentId, item.class_id, item.attended ? 1 : 0, updatedBy);
        }
      }
    }

    // 2. Assignment grade updates
    if (Array.isArray(assignments) && assignments.length > 0) {
      const asgStmt = db.prepare(`
        INSERT INTO student_assignment_grades (
          enrollment_id, assignment_id, marks_obtained, submission_status, remarks, graded_by, graded_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(enrollment_id, assignment_id) DO UPDATE SET
          marks_obtained = excluded.marks_obtained,
          submission_status = excluded.submission_status,
          remarks = excluded.remarks,
          graded_by = excluded.graded_by,
          graded_at = excluded.graded_at
      `);
      for (const item of assignments) {
        if (item.assignment_id) {
          const rawMarks = item.marks_obtained !== undefined ? item.marks_obtained : item.marks;
          const marksVal = (rawMarks !== null && rawMarks !== undefined && rawMarks !== '')
            ? Number(rawMarks)
            : null;
          asgStmt.run(
            enrollmentId,
            item.assignment_id,
            marksVal,
            item.submission_status || (marksVal !== null ? 'graded' : 'pending'),
            item.remarks || null,
            updatedBy
          );
        }
      }
    }

    // 3. Exam marks updates
    if (exam_marks) {
      const normalizePid = (em) => {
        if (em.phase_id !== undefined && em.phase_id !== null) return String(em.phase_id);
        if (em.phaseNumber !== undefined && em.phaseNumber !== null) return `p_${em.phaseNumber}`;
        return 'p_1';
      };
      const items = Array.isArray(exam_marks) ? exam_marks : [exam_marks];
      const examStmt = db.prepare(`
        INSERT INTO student_phase_results (
          enrollment_id, phase_id, exam_marks, calculated_at
        ) VALUES (?, ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(enrollment_id, phase_id) DO UPDATE SET
          exam_marks = excluded.exam_marks,
          calculated_at = excluded.calculated_at
      `);
      for (const item of items) {
        if (item.phase_id !== undefined || item.phaseNumber !== undefined) {
          const rawMarks = item.marks !== undefined ? item.marks : item.examMarks;
          const marksVal = (rawMarks !== null && rawMarks !== undefined && rawMarks !== '')
            ? Number(rawMarks)
            : null;
          examStmt.run(enrollmentId, normalizePid(item), marksVal);
        }
      }
    }

    // 4. Failure injection test hook (if specified)
    if (options && options.failureInjection) {
      throw new Error('Injected failure inside atomic transaction for testing rollback');
    }

    // 5. Recalculate phases and sync student_phase_results strictly INSIDE the same transaction
    const progress = getEnrollmentProgressSync(enrollmentId, db, options);
    if (progress && !progress.isLegacy) {
      syncPhaseResults(enrollmentId, progress.phases, db, options);
    }

    return progress;
  });

  return tx();
}

/**
 * Evaluate certificate eligibility for an enrollment
 */
export async function evaluateCertificateEligibility(enrollmentId, customDb = null, options = {}) {
  const progress = await getEnrollmentProgress(enrollmentId, customDb, options);
  if (!progress) {
    return { eligible: false, reEnrollmentDiscountPercentage: 0 };
  }

  if (progress.isLegacy) {
    return {
      eligible: progress.certificateEligible,
      reEnrollmentDiscountPercentage: 50 // Standard legacy default
    };
  }

  return {
    eligible: progress.certificateEligible,
    reEnrollmentDiscountPercentage: progress.completionPolicy?.reEnrollment?.discountPercentage || 0
  };
}

/**
 * Authoritative Phase Admission
 * Validates phase progression requirements and marks a phase as admitted.
 */
export async function admitStudentToPhase(enrollmentId, phaseNumber, customDb = null, options = {}) {
  const db = getDatabase(customDb);
  const enrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ?').get(enrollmentId);
  if (!enrollment) {
    throw new Error(`Enrollment ${enrollmentId} not found.`);
  }

  const pNum = Number(phaseNumber);
  if (isNaN(pNum) || pNum < 1) {
    throw new Error(`Invalid phase number: ${phaseNumber}`);
  }

  // Path A: Legacy Course (OFC)
  if (!enrollment.course_definition_id) {
    if (pNum === 2) {
      if (enrollment.step1_completed !== 1 || enrollment.step2_completed !== 1) {
        throw new Error('Cannot admit to Phase 2: Phase 1 exam must be passed first.');
      }
      const p1FeeRes = resolvePhaseFee({
        feeDetailsRaw: enrollment.fee_details,
        phaseIndex: 0,
        enrollment,
        courseName: enrollment.course_name,
        courseType: enrollment.course_type,
        batchId: enrollment.batch_id,
        customDb: db
      });
      if (!p1FeeRes.isPaid) {
        throw new Error('Cannot admit to Phase 2: Phase 1 fees must be fully paid first.');
      }
      db.transaction(() => {
        db.prepare(`
          UPDATE student_course_enrollments
          SET step3_completed = 1, updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(enrollmentId);
        db.prepare(`
          UPDATE student_profiles
          SET phase2_admitted = 1, updated_at = datetime('now', 'localtime')
          WHERE user_id = ?
        `).run(enrollment.user_id);
      })();
      return getEnrollmentProgressSync(enrollmentId, db, options);
    }
    return getEnrollmentProgressSync(enrollmentId, db, options);
  }

  // Path B: Defined Course
  const progress = getEnrollmentProgressSync(enrollmentId, db, options);
  if (!progress || !Array.isArray(progress.phases)) {
    throw new Error('Failed to evaluate course progress.');
  }

  if (pNum > progress.phases.length) {
    throw new Error(`Phase ${pNum} does not exist in course definition (total phases: ${progress.phases.length}).`);
  }

  const targetPhase = progress.phases[pNum - 1];
  const targetPhaseId = targetPhase.id;

  if (pNum > 1) {
    const prevPhase = progress.phases[pNum - 2];
    const phaseGates = progress.completionPolicy?.phaseGates || progress.completionPolicy?.phaseProgression || {};
    const sequential = phaseGates.sequentialProgression !== false;
    const reqPassed = phaseGates.requirePreviousPhasePassed !== false;
    const reqFees = !!phaseGates.requirePreviousPhaseFeesPaid;

    if (sequential) {
      if (reqPassed && prevPhase && !prevPhase.isPassed) {
        throw new Error(`Cannot admit to Phase ${pNum}: Phase ${pNum - 1} must be passed first.`);
      }
      if (reqFees) {
        const prevFeeRes = resolvePhaseFee({
          feeDetailsRaw: enrollment.fee_details,
          phaseIndex: pNum - 2,
          enrollment,
          courseDefinition: progress.definition,
          courseDefId: enrollment.course_definition_id,
          batchId: enrollment.batch_id,
          customDb: db
        });
        if (!prevFeeRes.isPaid) {
          throw new Error(`Cannot admit to Phase ${pNum}: Phase ${pNum - 1} fees must be fully paid first.`);
        }
      }
    }
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO student_phase_results (
        enrollment_id, phase_id, admitted, admitted_at, calculated_at
      ) VALUES (?, ?, 1, datetime('now', 'localtime'), datetime('now', 'localtime'))
      ON CONFLICT(enrollment_id, phase_id) DO UPDATE SET
        admitted = 1,
        admitted_at = datetime('now', 'localtime')
    `).run(enrollmentId, targetPhaseId);

    if (pNum === 2) {
      db.prepare(`
        UPDATE student_course_enrollments
        SET step3_completed = 1, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(enrollmentId);
      db.prepare(`
        UPDATE student_profiles
        SET phase2_admitted = 1, updated_at = datetime('now', 'localtime')
        WHERE user_id = ?
      `).run(enrollment.user_id);
    }
  })();

  return getEnrollmentProgressSync(enrollmentId, db, options);
}

/**
 * Authoritative Phase Reversal (Unadmit)
 * Enforces payment restriction: rejects reversal if payment has already been recorded for this phase.
 */
export async function unadmitStudentFromPhase(enrollmentId, phaseNumber, customDb = null, options = {}) {
  const db = getDatabase(customDb);
  const enrollment = db.prepare('SELECT * FROM student_course_enrollments WHERE id = ?').get(enrollmentId);
  if (!enrollment) {
    throw new Error(`Enrollment ${enrollmentId} not found.`);
  }

  const pNum = Number(phaseNumber);
  if (isNaN(pNum) || pNum < 1) {
    throw new Error(`Invalid phase number: ${phaseNumber}`);
  }

  if (pNum === 1) {
    throw new Error('Cannot undo admission for Phase 1: Phase 1 is the base enrollment phase.');
  }

  // 1. Payment restriction check: cannot unadmit if payment exists for this phase
  const hasPayment = hasPhasePaymentRecorded(enrollment.fee_details, pNum, {
    enrollment,
    courseDefId: enrollment.course_definition_id,
    batchId: enrollment.batch_id,
    customDb: db
  });
  if (hasPayment) {
    throw new Error('Cannot undo phase admission: payment has already been recorded for this phase.');
  }

  // 2. Subsequent phases check: cannot unadmit if subsequent phases are already admitted or completed
  if (!enrollment.course_definition_id) {
    // Legacy OFC
    if (pNum === 2 && enrollment.step4_completed === 1) {
      throw new Error('Cannot undo phase admission: Phase 2 has already been completed.');
    }
    db.transaction(() => {
      if (pNum === 2) {
        db.prepare(`
          UPDATE student_course_enrollments
          SET step3_completed = 0, updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(enrollmentId);
        db.prepare(`
          UPDATE student_profiles
          SET phase2_admitted = 0, updated_at = datetime('now', 'localtime')
          WHERE user_id = ?
        `).run(enrollment.user_id);
      }
    })();

    return getEnrollmentProgressSync(enrollmentId, db, options);
  }

  // Defined Course
  const progress = getEnrollmentProgressSync(enrollmentId, db, options);
  if (!progress || !Array.isArray(progress.phases)) {
    throw new Error('Failed to evaluate course progress.');
  }

  const targetPhase = progress.phases[pNum - 1];
  const targetPhaseId = targetPhase.id;

  // 2. Check if any phase > pNum is already admitted, completed, has active records or payments
  for (let i = pNum; i < progress.phases.length; i++) {
    const nextP = progress.phases[i];
    const hasNextAtt = (nextP.attendance?.attended || 0) > 0;
    const hasNextAsg = (nextP.assignments?.submittedCount || 0) > 0;
    const hasNextExam = nextP.exam?.taken;
    const hasNextPayment = hasPhasePaymentRecorded(enrollment.fee_details, i + 1, {
      enrollment,
      courseDefId: enrollment.course_definition_id,
      batchId: enrollment.batch_id,
      customDb: db
    });
    if (nextP.isAdmitted || nextP.isPassed || hasNextAtt || hasNextAsg || hasNextExam || hasNextPayment) {
      throw new Error(`Cannot undo phase admission: Phase ${i + 1} is already admitted, has active records, or has payments recorded.`);
    }
  }

  // 3. Completed phase check: cannot unadmit if target phase has already passed
  if (targetPhase.isPassed) {
    throw new Error(`Cannot undo phase admission: Phase ${pNum} has already been completed and passed.`);
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE student_phase_results
      SET admitted = 0, admitted_at = NULL
      WHERE enrollment_id = ? AND phase_id = ?
    `).run(enrollmentId, targetPhaseId);

    if (pNum === 2) {
      db.prepare(`
        UPDATE student_course_enrollments
        SET step3_completed = 0, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(enrollmentId);
      db.prepare(`
        UPDATE student_profiles
        SET phase2_admitted = 0, updated_at = datetime('now', 'localtime')
        WHERE user_id = ?
      `).run(enrollment.user_id);
    }
  })();

  return getEnrollmentProgressSync(enrollmentId, db, options);
}

export const courseProgressService = {
  getEnrollmentProgress,
  getEnrollmentProgressSync,
  recordClassAttendance,
  recordAssignmentGrade,
  recordExamMarks,
  updateDefinedProgressAtomic,
  evaluateCertificateEligibility,
  isPhaseFeePaid,
  hasPhasePaymentRecorded,
  admitStudentToPhase,
  unadmitStudentFromPhase
};

export default courseProgressService;
