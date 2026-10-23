import { test, expect } from '@playwright/test';
import { assertIsolatedTestDatabase, getTestDbPath, initIsolatedTestDatabase } from './test-db-isolation.js';

const DB_PATH = getTestDbPath();
assertIsolatedTestDatabase(DB_PATH);

test.describe('Course Progress Service & Dual-Model Evaluation', () => {
  let db;
  let progressService;
  let legacyEnrollmentId;
  let testCourseDefId;
  let definedEnrollmentId;
  let testUserId = 8; // Existing student

  test.beforeAll(async () => {
    db = await initIsolatedTestDatabase(DB_PATH);
    const mod = await import('../server/services/courseProgressService.js');
    progressService = mod.default || mod;

    // Pick an existing legacy enrollment (e.g. user 8, Online Filmmaking Course, id 1)
    const legacy = db.prepare("SELECT * FROM student_course_enrollments WHERE course_definition_id IS NULL LIMIT 1").get();
    legacyEnrollmentId = legacy.id;

    // Create a 2-phase published course definition for testing
    const defStmt = db.prepare(`
      INSERT INTO course_definitions (
        slug, version, name, course_type, phase_count, status, definition_json, created_by, updated_by
      ) VALUES (?, 1, ?, 'workshop', 2, 'published', ?, 1, 1)
    `);
    const defJson = JSON.stringify({
      basics: { name: 'Test Directing Workshop', type: 'workshop', phaseCount: 2 },
      phases: [
        {
          id: 'p1',
          phaseIndex: 1,
          title: 'Directing Actors',
          classCount: 2,
          requirements: { attendanceRequired: true, minAttendancePercent: 100, completionRequired: true },
          routine: [],
          classes: [
            { id: 'c1', title: 'Script Breakdown', mandatory: true },
            { id: 'c2', title: 'Rehearsal Techniques', mandatory: true }
          ],
          assignments: [
            { id: 'a1', title: 'Monologue Video', maxMarks: 20, passMarks: 10, submissionRequired: true }
          ],
          exam: { enabled: true, maxMarks: 80, passMarks: 40, phasePassThreshold: 50 }
        },
        {
          id: 'p2',
          phaseIndex: 2,
          title: 'Scene Staging & Blocking',
          classCount: 1,
          requirements: { attendanceRequired: false, completionRequired: true },
          routine: [],
          classes: [
            { id: 'c3', title: 'Floor Plans & Coverage', mandatory: true }
          ],
          assignments: [
            { id: 'a2', title: 'Scene Staging Clip', maxMarks: 50, passMarks: 25, submissionRequired: true }
          ],
          exam: { enabled: false }
        }
      ],
      completionPolicy: {
        certificateEligibility: { allRequiredPhasesPassed: true },
        reEnrollment: { discountEnabled: true, discountPercentage: 40 }
      }
    });

    const resDef = defStmt.run('test-directing-workshop', 'Test Directing Workshop', defJson);
    testCourseDefId = resDef.lastInsertRowid;

    // Create a student enrollment linked to this course definition
    const enrStmt = db.prepare(`
      INSERT INTO student_course_enrollments (
        user_id, course_name, course_type, course_definition_id, course_version, created_at, updated_at
      ) VALUES (?, 'Test Directing Workshop', 'workshop', ?, 1, datetime('now'), datetime('now'))
    `);
    const resEnr = enrStmt.run(testUserId, testCourseDefId);
    definedEnrollmentId = resEnr.lastInsertRowid;
  });

  test.afterAll(() => {
    if (db) {
      if (definedEnrollmentId) {
        db.prepare('DELETE FROM student_class_attendance WHERE enrollment_id = ?').run(definedEnrollmentId);
        db.prepare('DELETE FROM student_assignment_grades WHERE enrollment_id = ?').run(definedEnrollmentId);
        db.prepare('DELETE FROM student_phase_results WHERE enrollment_id = ?').run(definedEnrollmentId);
        db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(definedEnrollmentId);
      }
      if (testCourseDefId) {
        db.prepare('DELETE FROM course_definitions WHERE id = ?').run(testCourseDefId);
      }
      db.close();
    }
  });

  test('1. Legacy enrollment returns legacy authoritative progress with zero data corruption', async () => {
    const progress = await progressService.getEnrollmentProgress(legacyEnrollmentId, db);
    expect(progress).toBeDefined();
    expect(progress.isLegacy).toBe(true);
    expect(progress.course_definition_id).toBeNull();
    // Legacy fields present
    expect(progress.legacy).toBeDefined();
    expect(progress.legacy.step1_completed).toBeDefined();
    expect(progress.legacy.attendance_classes).toBeDefined();
  });

  test('2. Defined course enrollment starts with 0 attendance, pending assignments, and is_passed = 0', async () => {
    const progress = await progressService.getEnrollmentProgress(definedEnrollmentId, db);
    expect(progress).toBeDefined();
    expect(progress.isLegacy).toBe(false);
    expect(progress.phases.length).toBe(2);

    const phase1 = progress.phases[0];
    expect(phase1.title).toBe('Directing Actors');
    expect(phase1.attendance.percentage).toBe(0);
    expect(phase1.isPassed).toBe(false);
    expect(progress.certificateEligible).toBe(false);
  });

  test('3. Atomic attendance updates correctly update phase attendance percentage without race conditions', async () => {
    await progressService.recordClassAttendance(definedEnrollmentId, 'c1', 1, 1, db);
    let progress = await progressService.getEnrollmentProgress(definedEnrollmentId, db);
    expect(progress.phases[0].attendance.attendedClasses).toBe(1);
    expect(progress.phases[0].attendance.totalClasses).toBe(2);
    expect(progress.phases[0].attendance.percentage).toBe(50);

    // Attend 2nd class
    await progressService.recordClassAttendance(definedEnrollmentId, 'c2', 1, 1, db);
    progress = await progressService.getEnrollmentProgress(definedEnrollmentId, db);
    expect(progress.phases[0].attendance.attendedClasses).toBe(2);
    expect(progress.phases[0].attendance.percentage).toBe(100);
  });

  test('4. Atomic assignment grading records marks and pass status', async () => {
    // Grade a1 with 15 marks (pass mark 10)
    await progressService.recordAssignmentGrade(definedEnrollmentId, 'a1', 15, 'graded', 'Well directed', 1, db);
    const progress = await progressService.getEnrollmentProgress(definedEnrollmentId, db);
    const asg1 = progress.phases[0].assignments.find(a => a.id === 'a1');
    expect(asg1.marksObtained).toBe(15);
    expect(asg1.isPassed).toBe(true);
  });

  test('5. Record exam marks and verify phase 1 pass evaluation', async () => {
    // Phase 1 has: 100% attendance (met), a1 passed (15 marks), now add exam marks 45 (exam pass mark 40, threshold 50: 15+45 = 60 >= 50)
    await progressService.recordExamMarks(definedEnrollmentId, 'p1', 45, db);
    const progress = await progressService.getEnrollmentProgress(definedEnrollmentId, db);
    expect(progress.phases[0].exam.marksObtained).toBe(45);
    expect(progress.phases[0].isPassed).toBe(true);
    // Certificate is still false because phase 2 is not passed yet!
    expect(progress.certificateEligible).toBe(false);
  });

  test('6. Complete Phase 2 and verify Certificate eligibility unlocks with configurable discount', async () => {
    // Authoritative admission to Phase 2 before recording progress
    await progressService.admitStudentToPhase(definedEnrollmentId, 2, db);

    // Complete Phase 2: class c3 attended, assignment a2 graded 30/50
    await progressService.recordClassAttendance(definedEnrollmentId, 'c3', 1, 1, db);
    await progressService.recordAssignmentGrade(definedEnrollmentId, 'a2', 30, 'graded', 'Solid staging', 1, db);

    const progress = await progressService.getEnrollmentProgress(definedEnrollmentId, db);
    expect(progress.phases[1].isAdmitted).toBe(true);
    expect(progress.phases[1].isPassed).toBe(true);
    expect(progress.certificateEligible).toBe(true);

    const certCheck = await progressService.evaluateCertificateEligibility(definedEnrollmentId, db);
    expect(certCheck.eligible).toBe(true);
    expect(certCheck.reEnrollmentDiscountPercentage).toBe(40);
  });

  test('7. Atomic failure injection: guarantees 100% all-or-nothing rollback on error', async () => {
    // Capture pre-mutation snapshot of all related tables for this enrollment
    const preAttendance = db.prepare('SELECT * FROM student_class_attendance WHERE enrollment_id = ? ORDER BY class_id').all(definedEnrollmentId);
    const preGrades = db.prepare('SELECT * FROM student_assignment_grades WHERE enrollment_id = ? ORDER BY assignment_id').all(definedEnrollmentId);
    const preResults = db.prepare('SELECT * FROM student_phase_results WHERE enrollment_id = ? ORDER BY phase_id').all(definedEnrollmentId);

    // Attempt an atomic batch update with failure injection active
    let errorCaught = null;
    try {
      await progressService.updateDefinedProgressAtomic(
        definedEnrollmentId,
        {
          attendance: [{ class_id: 'c1', attended: false }], // would toggle c1
          assignments: [{ assignment_id: 'a1', marks: 5, submission_status: 'graded', remarks: 'Should rollback' }],
          exam_marks: [{ phase_id: 'p1', marks: 10 }]
        },
        db,
        { failureInjection: true }
      );
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(errorCaught.message).toContain('Injected failure inside atomic transaction');

    // Verify post-mutation records are 100% identical to pre-mutation snapshot
    const postAttendance = db.prepare('SELECT * FROM student_class_attendance WHERE enrollment_id = ? ORDER BY class_id').all(definedEnrollmentId);
    const postGrades = db.prepare('SELECT * FROM student_assignment_grades WHERE enrollment_id = ? ORDER BY assignment_id').all(definedEnrollmentId);
    const postResults = db.prepare('SELECT * FROM student_phase_results WHERE enrollment_id = ? ORDER BY phase_id').all(definedEnrollmentId);

    expect(postAttendance).toEqual(preAttendance);
    expect(postGrades).toEqual(preGrades);
    expect(postResults).toEqual(preResults);
  });

  test('8. Failure injection DURING summary synchronization rolls back attendance, assignments, and summary writes', async () => {
    // Capture baseline snapshot before attempt
    const preAttendance = db.prepare('SELECT * FROM student_class_attendance WHERE enrollment_id = ? ORDER BY class_id').all(definedEnrollmentId);
    const preGrades = db.prepare('SELECT * FROM student_assignment_grades WHERE enrollment_id = ? ORDER BY assignment_id').all(definedEnrollmentId);
    const preResults = db.prepare('SELECT * FROM student_phase_results WHERE enrollment_id = ? ORDER BY phase_id').all(definedEnrollmentId);

    let caughtErr = null;
    try {
      await progressService.updateDefinedProgressAtomic(
        definedEnrollmentId,
        {
          attendance: [{ class_id: 'c1', attended: true }],
          assignments: [{ assignment_id: 'a1', marks: 18, submission_status: 'graded' }],
          exam_marks: [{ phase_id: 'p1', marks: 55 }]
        },
        db,
        { failureInjectionInSync: true }
      );
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeDefined();
    expect(caughtErr.message).toContain('Injected failure inside phase-summary synchronization');

    // Confirm that every source record and summary record rolled back 100%
    const postAttendance = db.prepare('SELECT * FROM student_class_attendance WHERE enrollment_id = ? ORDER BY class_id').all(definedEnrollmentId);
    const postGrades = db.prepare('SELECT * FROM student_assignment_grades WHERE enrollment_id = ? ORDER BY assignment_id').all(definedEnrollmentId);
    const postResults = db.prepare('SELECT * FROM student_phase_results WHERE enrollment_id = ? ORDER BY phase_id').all(definedEnrollmentId);

    expect(postAttendance).toEqual(preAttendance);
    expect(postGrades).toEqual(preGrades);
    expect(postResults).toEqual(preResults);
  });

  test('9. Default unadmitted state for Phases 2–5 and builder phaseGates matrix', async () => {
    const gateCourseName = `Gate Matrix 3-Phase Course ${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const defStmt = db.prepare(`
      INSERT INTO course_definitions (
        slug, version, name, course_type, phase_count, status, definition_json, created_by, updated_by
      ) VALUES (?, 1, ?, 'workshop', 3, 'published', ?, 1, 1)
    `);

    const def3Json = JSON.stringify({
      basics: { name: gateCourseName, type: 'workshop', phaseCount: 3 },
      phases: [
        {
          id: 'gate_p1',
          phaseIndex: 1,
          title: 'Gate Phase 1',
          classCount: 1,
          requirements: { attendanceRequired: true, minAttendancePercent: 100, completionRequired: true },
          classes: [{ id: 'gate_c1', title: 'P1 Class', mandatory: true }],
          assignments: [{ id: 'gate_a1', title: 'P1 Asg', maxMarks: 50, passMarks: 25, submissionRequired: true }],
          exam: { enabled: true, maxMarks: 50, passMarks: 25 }
        },
        {
          id: 'gate_p2',
          phaseIndex: 2,
          title: 'Gate Phase 2',
          classCount: 1,
          requirements: { attendanceRequired: true, minAttendancePercent: 100, completionRequired: true },
          classes: [{ id: 'gate_c2', title: 'P2 Class', mandatory: true }],
          assignments: [{ id: 'gate_a2', title: 'P2 Asg', maxMarks: 50, passMarks: 25, submissionRequired: true }],
          exam: { enabled: true, maxMarks: 50, passMarks: 25 }
        },
        {
          id: 'gate_p3',
          phaseIndex: 3,
          title: 'Gate Phase 3',
          classCount: 1,
          requirements: { attendanceRequired: false, completionRequired: true },
          classes: [{ id: 'gate_c3', title: 'P3 Class', mandatory: false }],
          assignments: [],
          exam: { enabled: false }
        }
      ],
      completionPolicy: {
        phaseGates: {
          sequentialProgression: true,
          requirePreviousPhasePassed: true,
          requirePreviousPhaseFeesPaid: true
        }
      }
    });

    const resDef = defStmt.run(`gate-matrix-${Date.now()}`, gateCourseName, def3Json);
    const gateDefId = resDef.lastInsertRowid;

    let gateEnrId = null;
    try {
      // Enroll a test student
      const resEnr = db.prepare(`
        INSERT INTO student_course_enrollments (
          user_id, course_name, course_type, course_definition_id, course_version, fee_details, created_at, updated_at
        ) VALUES (?, ?, 'workshop', ?, 1, ?, datetime('now'), datetime('now'))
      `).run(testUserId, gateCourseName, gateDefId, JSON.stringify({
        phase1: { full_fee: '5000', amount_paid: '0', status: 'Pending' },
        phase2: { full_fee: '6000', amount_paid: '0', status: 'Pending' },
        phase3: { full_fee: '7000', amount_paid: '0', status: 'Pending' }
      }));
      gateEnrId = resEnr.lastInsertRowid;

      // 1. Initial State: Phase 1 is admitted; Phase 2 and 3 are NOT admitted and locked
      const initProg = await progressService.getEnrollmentProgress(gateEnrId, db);
      expect(initProg.phases[0].isAdmitted).toBe(true);
      expect(initProg.phases[0].status).toBe('in_progress');

      expect(initProg.phases[1].isAdmitted).toBe(false);
      expect(initProg.phases[1].isLocked).toBe(true);
      expect(initProg.phases[1].status).toBe('locked');

      expect(initProg.phases[2].isAdmitted).toBe(false);
      expect(initProg.phases[2].isLocked).toBe(true);
      expect(initProg.phases[2].status).toBe('locked');

      // 2. Attempt unauthorized admission to Phase 2 before Phase 1 is passed -> Rejection
      await expect(progressService.admitStudentToPhase(gateEnrId, 2, db)).rejects.toThrow(
        'Cannot admit to Phase 2: Phase 1 must be passed first.'
      );

      // 3. Pass Phase 1 criteria (attendance, assignment, exam)
      await progressService.recordClassAttendance(gateEnrId, 'gate_c1', 1, 1, db);
      await progressService.recordAssignmentGrade(gateEnrId, 'gate_a1', 30, 'graded', 'Pass', 1, db);
      await progressService.recordExamMarks(gateEnrId, 'gate_p1', 30, db);

      // 4. Phase 1 is now passed, but Phase 1 fee is NOT paid -> Rejection by fee gate rule
      await expect(progressService.admitStudentToPhase(gateEnrId, 2, db)).rejects.toThrow(
        'Cannot admit to Phase 2: Phase 1 fees must be fully paid first.'
      );

      // 5. Pay Phase 1 fee
      db.prepare(`
        UPDATE student_course_enrollments
        SET fee_details = json_set(fee_details, '$.phase1.amount_paid', '5000', '$.phase1.status', 'Paid')
        WHERE id = ?
      `).run(gateEnrId);

      // Phase 2 is now unlocked and pending admission
      const unlockedProg = await progressService.getEnrollmentProgress(gateEnrId, db);
      expect(unlockedProg.phases[1].isLocked).toBe(false);
      expect(unlockedProg.phases[1].isAdmitted).toBe(false);
      expect(unlockedProg.phases[1].status).toBe('pending_admission');

      // 6. Authoritative admission to Phase 2 -> Succeeded!
      const admittedP2Prog = await progressService.admitStudentToPhase(gateEnrId, 2, db);
      expect(admittedP2Prog.phases[1].isAdmitted).toBe(true);
      expect(admittedP2Prog.phases[1].status).toBe('in_progress');
    } finally {
      // Clean up gate test records
      if (gateEnrId) {
        db.prepare('DELETE FROM student_class_attendance WHERE enrollment_id = ?').run(gateEnrId);
        db.prepare('DELETE FROM student_assignment_grades WHERE enrollment_id = ?').run(gateEnrId);
        db.prepare('DELETE FROM student_phase_results WHERE enrollment_id = ?').run(gateEnrId);
        db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(gateEnrId);
      }
      db.prepare('DELETE FROM course_definitions WHERE id = ?').run(gateDefId);
    }
  });

  test('10. Admission reversal protections: payment defense, completed phase defense, downstream defense, and state transitions', async () => {
    const revCourseName = `Reversal Defense 3-Phase Course ${Date.now()}_${Math.random().toString(36).substring(7)}`;
    // Create a 3-phase test course definition
    const defJson = JSON.stringify({
      basics: { name: revCourseName, type: 'workshop', phaseCount: 3 },
      phases: [
        { id: 'rev_p1', phaseIndex: 1, title: 'Phase 1', classCount: 1, classes: [{ id: 'rev_c1', mandatory: true }], assignments: [], exam: { enabled: false } },
        { id: 'rev_p2', phaseIndex: 2, title: 'Phase 2', classCount: 1, classes: [{ id: 'rev_c2', mandatory: true }], assignments: [], exam: { enabled: false } },
        { id: 'rev_p3', phaseIndex: 3, title: 'Phase 3', classCount: 1, classes: [{ id: 'rev_c3', mandatory: true }], assignments: [], exam: { enabled: false } }
      ],
      completionPolicy: {
        phaseGates: { sequentialProgression: true, requirePreviousPhasePassed: false, requirePreviousPhaseFeesPaid: false }
      }
    });

    const resDef = db.prepare(`
      INSERT INTO course_definitions (
        slug, version, name, course_type, phase_count, status, definition_json, created_by, updated_by
      ) VALUES (?, 1, ?, 'workshop', 3, 'published', ?, 1, 1)
    `).run(`rev-defense-${Date.now()}`, revCourseName, defJson);
    const revDefId = resDef.lastInsertRowid;

    let revEnrId = null;
    try {
      const resEnr = db.prepare(`
        INSERT INTO student_course_enrollments (
          user_id, course_name, course_type, course_definition_id, course_version, fee_details, created_at, updated_at
        ) VALUES (?, ?, 'workshop', ?, 1, ?, datetime('now'), datetime('now'))
      `).run(testUserId, revCourseName, revDefId, JSON.stringify({
        phase1: { full_fee: '3000', amount_paid: '3000', status: 'Paid' },
        phase2: { full_fee: '4000', amount_paid: '0', status: 'Pending' },
        phase3: { full_fee: '5000', amount_paid: '0', status: 'Pending' }
      }));
      revEnrId = resEnr.lastInsertRowid;

      // 1. Reversing Phase 1 is strictly blocked (base enrollment phase)
      await expect(progressService.unadmitStudentFromPhase(revEnrId, 1, db)).rejects.toThrow(
        'Cannot undo admission for Phase 1: Phase 1 is the base enrollment phase.'
      );

      // 2. Admit Phase 2
      await progressService.admitStudentToPhase(revEnrId, 2, db);
      let prog = await progressService.getEnrollmentProgress(revEnrId, db);
      expect(prog.phases[1].isAdmitted).toBe(true);

      // 3. Record payment for Phase 2 -> Reversal is strictly rejected by payment defense
      db.prepare(`
        UPDATE student_course_enrollments
        SET fee_details = json_set(fee_details, '$.phase2.amount_paid', '1500', '$.phase2.status', 'Partial')
        WHERE id = ?
      `).run(revEnrId);

      await expect(progressService.unadmitStudentFromPhase(revEnrId, 2, db)).rejects.toThrow(
        'Cannot undo phase admission: payment has already been recorded for this phase.'
      );

      // 4. Clear Phase 2 payment, then admit Phase 3 -> Reversing Phase 2 is blocked by downstream Phase 3
      db.prepare(`
        UPDATE student_course_enrollments
        SET fee_details = json_set(fee_details, '$.phase2.amount_paid', '0', '$.phase2.status', 'Pending')
        WHERE id = ?
      `).run(revEnrId);

      await progressService.admitStudentToPhase(revEnrId, 3, db);
      prog = await progressService.getEnrollmentProgress(revEnrId, db);
      expect(prog.phases[2].isAdmitted).toBe(true);

      await expect(progressService.unadmitStudentFromPhase(revEnrId, 2, db)).rejects.toThrow(
        'Cannot undo phase admission: Phase 3 is already admitted, has active records, or has payments recorded.'
      );

      // 5. Unadmit Phase 3 first (succeeds), then unadmit Phase 2 (succeeds)
      const unadmitP3Prog = await progressService.unadmitStudentFromPhase(revEnrId, 3, db);
      expect(unadmitP3Prog.phases[2].isAdmitted).toBe(false);
      expect(unadmitP3Prog.phases[2].status).toBe('pending_admission');

      const unadmitP2Prog = await progressService.unadmitStudentFromPhase(revEnrId, 2, db);
      expect(unadmitP2Prog.phases[1].isAdmitted).toBe(false);
      expect(unadmitP2Prog.phases[1].status).toBe('pending_admission');
    } finally {
      // Clean up reversal test records
      if (revEnrId) {
        db.prepare('DELETE FROM student_phase_results WHERE enrollment_id = ?').run(revEnrId);
        db.prepare('DELETE FROM student_course_enrollments WHERE id = ?').run(revEnrId);
      }
      db.prepare('DELETE FROM course_definitions WHERE id = ?').run(revDefId);
    }
  });
});
