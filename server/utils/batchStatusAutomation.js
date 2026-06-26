/**
 * Batch Status Automation Engine — Step 8
 *
 * Automatically transitions batch statuses:
 *   upcoming  →  active     when start_date is reached
 *   active    →  completed  when end_date has passed OR all students completed
 *
 * Exports one public function: runBatchStatusAutomation(db, triggeredBy?)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Check if all enrolled students in a batch have completed the course
// Adapts to actual schema (no "progression" JSON column — uses step columns)
// ─────────────────────────────────────────────────────────────────────────────
function checkAllStudentsCompleted(db, batch) {
  if (!batch.student_count || batch.student_count === 0) return false;

  const students = db.prepare(`
    SELECT
      sce.step2_completed,
      sce.step4_completed,
      sce.course_name
    FROM batch_students bs
    JOIN student_course_enrollments sce
      ON sce.user_id = bs.student_id
      AND sce.course_name = ?
    WHERE bs.batch_id = ?
  `).all(batch.course_name, batch.id);

  // If no enrollment rows at all, we cannot confirm completion
  if (students.length === 0) return false;

  return students.every(student => {
    // Online Filmmaking Course: requires step4 (Phase 2) complete
    if (batch.course_name === 'Online Filmmaking Course') {
      return student.step4_completed === 1;
    }
    // Workshop courses: requires step2 complete
    return student.step2_completed === 1;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Insert notification for a single user (direct DB insert, same pattern
//         as admin.js and fee-tracker.js — no abstraction layer exists yet)
// ─────────────────────────────────────────────────────────────────────────────
function insertNotificationRow(db, userId, type, title, message, link) {
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, type, title, message, link);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Send admin notifications when a batch transitions
//         Wrapped in try/catch so notification failure never rolls back the DB
// ─────────────────────────────────────────────────────────────────────────────
function sendTransitionNotification(db, batch, newStatus, reason) {
  try {
    const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all();

    const statusEmoji = { active: '🟢', completed: '✅' };

    const title = 'Batch Status Updated';
    const message = newStatus === 'active'
      ? `${statusEmoji.active} "${batch.batch_name}" is now Active — the course has started.`
      : `${statusEmoji.completed} "${batch.batch_name}" has been marked Completed — ${reason}.`;

    // Use the batch's DB id for the link (reliable, always numeric)
    const link = `/admin/batches/${batch.id}`;

    for (const admin of admins) {
      insertNotificationRow(db, admin.id, 'batch_status_change', title, message, link);
    }
  } catch (notifError) {
    // Notification failure must never affect the transition transaction
    console.error('[BatchAutomation] ⚠️  Notification delivery failed (non-critical):', notifError.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Apply a single status transition atomically
//   1. Update batches.status
//   2. Log to batch_status_transitions (audit trail)
//   3. Send admin notifications (outside transaction — non-critical)
// ─────────────────────────────────────────────────────────────────────────────
function applyTransition(db, batch, newStatus, reason, triggeredBy) {
  const triggerType = triggeredBy ? 'manual' : 'automatic';

  // Safety guard: never downgrade status
  const statusOrder = { upcoming: 0, active: 1, completed: 2, archived: 3 };
  if ((statusOrder[newStatus] ?? -1) <= (statusOrder[batch.status] ?? -1)) {
    console.warn(
      `[BatchAutomation] ⚠️  Skipping downgrade attempt: ${batch.batch_name} ` +
      `${batch.status} → ${newStatus} — not allowed`
    );
    return;
  }

  const transition = db.transaction(() => {
    // 1. Update the batch status
    db.prepare(`
      UPDATE batches
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newStatus, batch.id);

    // 2. Log the transition (append-only audit row)
    db.prepare(`
      INSERT INTO batch_status_transitions
        (batch_id, batch_name, from_status, to_status, trigger_type, triggered_by, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      batch.id,
      batch.batch_name,
      batch.status,
      newStatus,
      triggerType,
      triggeredBy || null,
      reason
    );
  });

  transition();

  console.log(
    `[BatchAutomation] ✅ ${batch.batch_name}: ${batch.status} → ${newStatus} (${reason})`
  );

  // 3. Send notifications — outside the transaction so failure is non-fatal
  sendTransitionNotification(db, batch, newStatus, reason);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export: runBatchStatusAutomation(db, triggeredBy?)
//
// Parameters:
//   db          — existing better-sqlite3 instance (do NOT create a new one)
//   triggeredBy — admin user_id if manually triggered, null if automatic
//
// Returns:
//   { ran_at, batches_checked, transitions: [...], errors: [...] }
// ─────────────────────────────────────────────────────────────────────────────
export function runBatchStatusAutomation(db, triggeredBy = null) {
  const results = {
    ran_at: new Date().toISOString(),
    batches_checked: 0,
    transitions: [],
    errors: []
  };

  // TODAY as YYYY-MM-DD string for date comparisons (SQLite DATE format)
  const today = new Date().toISOString().split('T')[0];

  console.log('[BatchAutomation] ─────────────────────────────────────────────');
  console.log(`[BatchAutomation] Run started at ${results.ran_at}`);

  try {
    // Fetch all non-archived, non-completed batches with student counts.
    // 'completed' is excluded because we never downgrade and there's nothing
    // to check — avoids needless processing on large datasets.
    const batches = db.prepare(`
      SELECT
        b.*,
        COUNT(bs.id) as student_count
      FROM batches b
      LEFT JOIN batch_students bs ON bs.batch_id = b.id
      WHERE b.status NOT IN ('archived', 'completed')
      GROUP BY b.id
    `).all();

    results.batches_checked = batches.length;
    console.log(`[BatchAutomation] Checking ${batches.length} non-archived/non-completed batches...`);

    for (const batch of batches) {
      try {
        let newStatus = null;
        let reason = null;

        // ── Rule 1: upcoming → active ────────────────────────────────────────
        if (
          batch.status === 'upcoming' &&
          batch.start_date &&
          batch.start_date <= today
        ) {
          newStatus = 'active';
          reason = `start_date reached (${batch.start_date})`;
        }

        // ── Rule 2A: active → completed (date-based) ─────────────────────────
        else if (
          batch.status === 'active' &&
          batch.end_date &&
          batch.end_date < today
        ) {
          newStatus = 'completed';
          reason = `end_date passed (${batch.end_date})`;
        }

        // ── Rule 2B: active → completed (progress-based) ─────────────────────
        // Only fires when end_date hasn't passed yet (or isn't set)
        // AND there is at least one student enrolled
        else if (
          batch.status === 'active' &&
          batch.student_count > 0 &&
          // Date guard: end_date either not set or hasn't passed
          (!batch.end_date || batch.end_date >= today)
        ) {
          const allDone = checkAllStudentsCompleted(db, batch);
          if (allDone) {
            newStatus = 'completed';
            reason = `all ${batch.student_count} student(s) completed the course`;
          }
        }

        // ── Apply transition if a rule fired ─────────────────────────────────
        if (newStatus) {
          applyTransition(db, batch, newStatus, reason, triggeredBy);
          results.transitions.push({
            batch_id: batch.id,
            batch_name: batch.batch_name,
            from_status: batch.status,
            to_status: newStatus,
            reason
          });
        } else {
          console.log(`[BatchAutomation] — ${batch.batch_name}: no change needed`);
        }

      } catch (batchError) {
        results.errors.push({
          batch_id: batch.id,
          batch_name: batch.batch_name,
          error: batchError.message
        });
        console.error(
          `[BatchAutomation] Error processing batch "${batch.batch_name}":`,
          batchError
        );
      }
    }

  } catch (globalError) {
    results.errors.push({ error: globalError.message });
    console.error('[BatchAutomation] ❌ Fatal error during run:', globalError);
  }

  console.log(
    `[BatchAutomation] Run complete. ` +
    `${results.batches_checked} checked, ` +
    `${results.transitions.length} transition(s), ` +
    `${results.errors.length} error(s)`
  );
  console.log('[BatchAutomation] ─────────────────────────────────────────────');

  return results;
}
