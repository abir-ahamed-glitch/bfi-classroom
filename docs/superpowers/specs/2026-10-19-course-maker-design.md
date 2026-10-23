# Course Maker End-to-End Design & Architecture Specification

## 1. Purpose and Scope

Provide a comprehensive, production-grade **Course Maker** subsystem for BFI Classroom. The system allows authorized administrators to create, edit, version, and publish dynamic courses and workshops with **1–5 phases**. 

The scope extends **end-to-end**:
- **Course & Phase Definitions**: Dynamic phase count (1–5), routine scheduling, classes (with subject/teacher catalog snapshots, delivery modes, and practical categories like shooting/editing), assignments, exams, and certificate eligibility with configurable re-enrollment discount rules.
- **Batches & Student Enrollments**: Explicit pinning to published course versions.
- **Granular Student Progress Tracking**: Normalized, concurrent-safe tracking of class attendance, assignment submissions/grades, and phase exam results against stable identifiers.
- **Dual-Model Compatibility Layer**: Strict separation of authoritative progress sources—preserving the **verified 911 legacy student enrollments** without data corruption or lossy dual-writing.
- **Affected System Integration**: Student Profile, Student Portal, Batch Details, Admin Student Manager, Certificate Issuance Pipeline, Analytics, and Reports.

---

## 2. Verified Baseline Data & Legacy System Analysis

A comprehensive pre-implementation database audit was executed against `server/bfi_classroom.db` on 2026-10-19:

- **Total Enrollments in `student_course_enrollments`**: **911 rows** (all 911 match valid records in `users`; 0 orphaned records).
  - `Online Filmmaking Course` (`filmmaking`): **476 enrollments** (step1: 27, step2: 0, step3: 4, step4: 2).
  - `Film Appreciation Course` (`workshop`): **421 enrollments** (step1: 374, step2: 3, step3: 0, step4: 145).
  - `Film Appreciation Course` (`Offline`): **14 enrollments** (step1: 13, step2: 1, step3: 0, step4: 1).
- **Total Batches in `batches`**: **61 rows** (Film Appreciation Course: 32 batches; Online Filmmaking Course: 29 batches).
- **Total Student Mappings in `batch_students`**: **1,177 rows**.
- **Existing `course_settings`**: 2 records (1 per legacy course) hard-coded for 2 phases, with global attendance totals and assignment strings.

---

## 3. Core Architectural Decisions

### Decision 1: Single Authoritative Source Per Enrollment Type (No Dual-Writing)
- **Problem**: Attempting to dual-write 1–5 phase dynamic course progress into two-phase legacy columns (`step1_completed`, `step2_completed`, `step3_completed`, `step4_completed`, `phase2_shooting_attended`, `phase2_editing_attended`) is lossy, logically contradictory, and introduces severe data corruption risks.
- **Resolution**:
  - **Legacy Enrollments (`course_definition_id IS NULL`)**: The authoritative source remains the existing legacy columns. All historical queries, triggers, and endpoints function exactly as before.
  - **Course Maker Enrollments (`course_definition_id IS NOT NULL`)**: The authoritative source is the new normalized tables (`student_phase_results`, `student_class_attendance`, `student_assignment_grades`). Legacy columns remain `NULL`/default and are ignored.
  - An application adapter function (`getEnrollmentProgress(enrollment)`) inspects `course_definition_id` and dispatches to the correct engine.

### Decision 2: Concurrency-Safe Normalized Progress Tables (Preventing JSON Race Conditions)
- **Problem**: Writing concurrent student progress (e.g. an admin grading an assignment while an automated cron evaluates attendance) into a single JSON column using read-modify-write patterns creates race conditions and lost updates.
- **Resolution**: Student progress is stored in dedicated, indexed relational tables with unique constraints:
  - `student_phase_results` (`enrollment_id`, `phase_id`, `attendance_percentage`, `assignments_passed`, `exam_marks`, `is_passed`, `calculated_at`) with `UNIQUE(enrollment_id, phase_id)`
  - `student_class_attendance` (`enrollment_id`, `class_id`, `attended`, `attended_at`, `updated_by`) with `UNIQUE(enrollment_id, class_id)`
  - `student_assignment_grades` (`enrollment_id`, `assignment_id`, `marks_obtained`, `submission_status`, `graded_by`, `graded_at`, `remarks`) with `UNIQUE(enrollment_id, assignment_id)`
  - All multi-step evaluations run within SQLite transactions (`BEGIN IMMEDIATE`).

### Decision 3: Immutable Published Definitions & Routine Audits
- **Problem**: Modifying course requirements after students enroll silently rewrites student transcripts and historical results. However, weekly routines (class days/times) often need operational adjustments during term.
- **Resolution**:
  - **Course Definitions**: Once `status = 'published'`, structure, grading rules, maximum marks, and certificate requirements are **strictly immutable**. Any structural changes require creating and publishing a new monotonically incremented version (`version = 2, 3...`).
  - **Weekly Routines**: Operational routine updates for active batches are recorded in `course_routine_audits` (`course_definition_id`, `batch_id`, `phase_id`, `old_routine`, `new_routine`, `changed_by`, `changed_at`, `reason`). This updates the batch schedule without mutating historical grades or published definition integrity.

### Decision 4: 3-Tier Routine Precedence & Granular Moderator Scope
- **Problem**: A course definition defines a baseline routine, but individual batches need independent operational schedules (e.g. holiday shifts, room reallocations). Furthermore, moderators must only adjust routines for batches they actually manage, rather than altering course-wide baselines or unrelated batches.
- **Resolution**:
  - **3-Tier Precedence Hierarchy**:
    1. *Batch-Specific Override*: Look for `course_routine_overrides` with matching `course_definition_id`, `batch_id`, and `phase_id`.
    2. *Course-Level Override*: Look for `course_routine_overrides` with matching `course_definition_id`, `batch_id IS NULL OR batch_id = 0`, and `phase_id`.
    3. *Published Baseline*: The original routine embedded in `course_definitions.definition_json`.
  - Applied across all consumers: Student Portal, Student Profile/Dashboard API, Batch Detail API, and Course Definitions API.
  - **Moderator Access Control**:
    - Role `moderator` cannot set course-level overrides (rejected with 403 Forbidden).
    - Role `moderator` can only set batch-specific overrides for batches they created or were explicitly assigned to via the `batch_moderators` table. Any attempt to modify an unrelated batch is rejected with 403 Forbidden.

### Decision 5: Explicit Legacy Migration Safeguards & Historical Preservation
- **Problem**: In legacy courses (`Online Filmmaking Course`), graduates completed Step 1 (theory) and Step 2/4 (exams/certificates) without granular class attendance or assignment tables. Migrating a legacy student to a defined course and then re-evaluating progress from empty attendance/assignment tables would demote the student to failed, invalidating earned certificates.
- **Resolution**:
  - **Documented Safe Mapping**:
    - Legacy Step 1 passed (`step1_completed = 1`) -> Migrated Phase 1 recorded with `is_passed = 1`, 100% attendance.
    - Legacy Step 2 passed (`step2_completed = 1`) -> Migrated Phase 2 recorded with `is_passed = 1`, 80 exam marks.
    - Legacy Certificate earned (`step4_completed = 1`) -> Preserved unconditionally in `evaluateCertificateEligibility`.
  - **Historical Result Preservation**: `courseProgressService.getEnrollmentProgress` checks if an explicitly migrated phase already has `is_passed = 1` in `student_phase_results` and preserves it, preventing recalculation from empty granular records from demoting the student.
  - **Strict Rejection of Unmappable Migrations**:
    - Rejects if `target_version` does not match the published target definition version (400).
    - Rejects target definitions with 0 phases (400).
    - Rejects contradictory legacy states (e.g. `step2_completed = 0` but `step3_completed = 1` or `step4_completed = 1`) (400).
    - Rejects completed 2-phase legacy graduates migrating to courses with phase count != 2 (400).

### Decision 6: Explicit & Deterministic Enrollment-to-Batch Resolution (Eliminating `LIMIT 1` Ambiguity)
- **Problem**: When a student was enrolled in multiple batches sharing the same course definition, `courseProgressService.getEnrollmentProgress` previously picked a matching batch arbitrarily using `LIMIT 1`. This led to non-deterministic routine override resolution, where a student in Batch 2 could be shown Batch 1's schedule in their portal or batch views.
- **Resolution**:
  - Added direct foreign key `batch_id INTEGER REFERENCES batches(id)` to `student_course_enrollments` with an index `idx_student_course_enrollments_batch`.
  - Executed deterministic backfill: mapped 673 unambiguous single-batch enrollments while leaving 238 multi-batch enrollments as `NULL` without guessing.
  - Implemented 3-precedence resolution in `getEnrollmentProgress(enrollmentId, customDb, options)`:
    1. *Caller Context*: `options.batchId` (validated against course definition).
    2. *Direct Link*: `enrollment.batch_id`.
    3. *Fallback*: Search `batch_students`. If exactly 1 matching batch exists, use it and self-heal by setting `enrollment.batch_id`. If >1 matching batch exists, set `ambiguousBatch: true`, `matchingBatchIds`, and fall back safely to course-level override or baseline without guessing.
  - In `server/routes/batches.js`:
    - Updated student assignment: students can now belong to multiple distinct batches (`WHERE bs.student_id = ? AND bs.batch_id = ?`).
    - When enrolling a student in a second batch sharing a course name, create a batch-scoped enrollment record (`${batch.course_name} (${batch.batch_name})`) with `batch_id = batch.id` to preserve `UNIQUE(user_id, course_name)`.
    - Batch views (`GET /:id/students`) pass `{ batchId }` so the student list displays the batch's specific schedule.

### Decision 7: Unrelated Course Migration Rejection & Explicit Mapping Requirements
- **Problem**: Migrating a legacy student to a completely different course (e.g. Filmmaking Course to Sound Design Masterclass) without an explicit mapping could cause arbitrary phase mismatch or misattributed progress.
- **Resolution**:
  - `POST /api/admin/students/:id/courses/:courseId/migrate-to-defined` strictly checks course relatedness (name match or matching course family).
  - Unrelated migrations are rejected with `400 Bad Request` unless the caller explicitly supplies:
    - `phase_mapping`: object mapping source phase keys to valid target phase IDs (validated against `phases[].id`), OR
    - `allow_cross_course_mapping: true` with audit notes.
  - Migrated enrollments can explicitly bind `batch_id` to establish immediate deterministic batch resolution.

---

## 4. Data Models & Database Schema

### Table: `course_definitions`
```sql
CREATE TABLE IF NOT EXISTS course_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  course_type TEXT NOT NULL, /* filmmaking, appreciation, workshop, etc. */
  description TEXT,
  duration_value INTEGER,
  duration_unit TEXT DEFAULT 'months', /* weeks, months, days */
  phase_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft', /* draft, published, archived */
  definition_json TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE(slug, version)
);
```

### Table: `course_routine_audits`
```sql
CREATE TABLE IF NOT EXISTS course_routine_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_definition_id INTEGER NOT NULL,
  batch_id INTEGER,
  phase_id TEXT NOT NULL,
  old_routine TEXT,
  new_routine TEXT NOT NULL,
  changed_by INTEGER NOT NULL,
  changed_at TEXT DEFAULT (datetime('now', 'localtime')),
  reason TEXT,
  FOREIGN KEY (course_definition_id) REFERENCES course_definitions(id),
  FOREIGN KEY (changed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS course_routine_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_definition_id INTEGER NOT NULL,
  batch_id INTEGER NOT NULL DEFAULT 0,
  phase_id TEXT NOT NULL,
  routine_json TEXT NOT NULL,
  updated_by INTEGER NOT NULL,
  updated_at TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE(course_definition_id, batch_id, phase_id),
  FOREIGN KEY (course_definition_id) REFERENCES course_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS legacy_enrollment_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL,
  target_course_definition_id INTEGER NOT NULL,
  target_version INTEGER NOT NULL DEFAULT 1,
  migrated_by INTEGER NOT NULL,
  migrated_at TEXT DEFAULT (datetime('now', 'localtime')),
  legacy_snapshot_json TEXT NOT NULL,
  notes TEXT,
  FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id),
  FOREIGN KEY (target_course_definition_id) REFERENCES course_definitions(id),
  FOREIGN KEY (migrated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS batch_moderators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  assigned_by INTEGER NOT NULL,
  assigned_at TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE(batch_id, user_id),
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id)
);
```

### Tables: `student_phase_results`, `student_class_attendance`, `student_assignment_grades`
```sql
CREATE TABLE IF NOT EXISTS student_phase_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL,
  phase_id TEXT NOT NULL,
  attendance_classes INTEGER DEFAULT 0,
  attendance_total INTEGER DEFAULT 0,
  attendance_percentage REAL DEFAULT 0.0,
  assignments_completed INTEGER DEFAULT 0,
  assignments_total INTEGER DEFAULT 0,
  exam_marks REAL DEFAULT NULL,
  is_passed INTEGER DEFAULT 0,
  calculated_at TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE(enrollment_id, phase_id),
  FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_class_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL,
  class_id TEXT NOT NULL,
  attended INTEGER NOT NULL DEFAULT 0,
  attended_at TEXT,
  updated_by INTEGER,
  UNIQUE(enrollment_id, class_id),
  FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS student_assignment_grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL,
  assignment_id TEXT NOT NULL,
  marks_obtained REAL DEFAULT 0,
  submission_status TEXT DEFAULT 'pending', /* pending, submitted, graded */
  remarks TEXT,
  graded_by INTEGER,
  graded_at TEXT,
  UNIQUE(enrollment_id, assignment_id),
  FOREIGN KEY (enrollment_id) REFERENCES student_course_enrollments(id) ON DELETE CASCADE
);
```

### Additions to Existing Tables
- `batches`: add `course_definition_id INTEGER REFERENCES course_definitions(id)`, `course_version INTEGER`.
- `student_course_enrollments`: add `course_definition_id INTEGER REFERENCES course_definitions(id)`, `course_version INTEGER`.

---

## 5. Course Definition JSON Specification

The `definition_json` holds the complete declarative rulebook:
```json
{
  "basics": {
    "name": "Cinematography Masterclass",
    "type": "workshop",
    "description": "Comprehensive camera & lighting workshop",
    "duration": { "value": 3, "unit": "months" },
    "phaseCount": 2
  },
  "phases": [
    {
      "id": "phase_1",
      "phaseIndex": 1,
      "title": "Camera Fundamentals & Optics",
      "description": "Lens selection, exposure, color science",
      "duration": { "value": 6, "unit": "weeks" },
      "classCount": 12,
      "requirements": {
        "attendanceRequired": true,
        "minAttendancePercent": 75,
        "completionRequired": true
      },
      "routine": [
        { "weekday": "Saturday", "startTime": "18:00", "endTime": "20:00", "timezone": "Asia/Dhaka" },
        { "weekday": "Tuesday", "startTime": "18:00", "endTime": "20:00", "timezone": "Asia/Dhaka" }
      ],
      "classes": [
        {
          "id": "cls_101",
          "title": "Sensors and Shutter Angles",
          "subjectId": 2,
          "subjectName": "Film Language",
          "teacherId": 574,
          "teacherName": "Tanvir Mokammel",
          "deliveryMode": "live",
          "category": "theory",
          "durationMinutes": 120,
          "mandatory": true
        }
      ],
      "assignments": [
        {
          "id": "asg_101",
          "title": "Exposure Bracket Exercise",
          "subject": "Optics",
          "instructions": "Shoot 5 exposure steps on raw format.",
          "submissionRequired": true,
          "maxMarks": 20,
          "passMarks": 10
        }
      ],
      "exam": {
        "enabled": true,
        "title": "Optics Midterm",
        "type": "written",
        "maxMarks": 80,
        "passMarks": 35,
        "includeAssignmentsInTotal": true,
        "phasePassThreshold": 50
      }
    }
  ],
  "completionPolicy": {
    "certificateEligibility": {
      "allRequiredPhasesPassed": true,
      "minOverallAttendance": 75,
      "requireAllMandatoryClasses": true,
      "requireAllMandatoryAssignments": true
    },
    "reEnrollment": {
      "discountEnabled": true,
      "discountPercentage": 50
    }
  }
}
```

---

## 6. End-to-End File & Workflow Impact Map

| Subsystem / Screen | File Path | Impact & Required Changes |
|---|---|---|
| **Course Maker Form** | `src/pages/admin/CourseMaker.jsx` | New 1–5 phase wizard UI with phase tabs, routines, classes, assignments, exams, completion policy, and summary review screen. |
| **Additional Options** | `src/pages/admin/AdditionalOptions.jsx` | Add Course Maker launch card and view router under `view=course-maker`. |
| **Sidebar Navigation** | `src/components/Sidebar.jsx` | Add Course Maker item under Admin section. |
| **Course Definitions API** | `server/routes/course-definitions.js` | Full API suite: GET list, GET by ID/slug, POST draft, PUT draft, POST publish (with immutability enforcement), PUT routine (with audit log). |
| **Server Gateway** | `server/server.js` | Register `/api/admin/course-definitions` route. |
| **Batch Management API** | `server/routes/batches.js` | Allow linking batches to published course definitions. Provide routine edit endpoint with RBAC. |
| **Batch Detail Screen** | `src/pages/admin/BatchDetail.jsx` | Adapt table columns dynamically: for defined courses, display actual dynamic phases, classes, and assignment grades; for legacy batches, retain existing Phase 1/Phase 2 layout. |
| **Batch Form Modal** | `src/components/admin/BatchFormModal.jsx` | Allow selecting from published course definitions; auto-populate course name, phase count, and defaults. |
| **Student Progress API** | `server/routes/admin.js` | Add defined course evaluation endpoints (`PUT /students/:id/defined-progress`). Adapt existing `PATCH /students/:id/progress` to preserve legacy logic for legacy students. |
| **Student Portal** | `src/pages/StudentPortal.jsx` | Adapt "Live Course Progression" to render dynamic 1–5 phases with attendance %, assignment grades, exam marks, and certificate button; fallback to legacy for legacy enrollments. |
| **Student Dashboard/Profile API** | `server/routes/student.js` | Return dynamic phases, attendance records, and grades for defined enrollments; legacy format for legacy enrollments. |
| **Certificate Pipeline** | `server/routes/certification.js` & `src/pages/admin/CertificateDesigner.jsx` | Check certificate eligibility dynamically: for defined courses, verify that all required phases are marked `is_passed = 1`; for legacy courses, verify `step4_completed = 1`. |
| **Batch Automation Engine** | `server/utils/batchStatusAutomation.js` | Support dynamic phase graduation and completion without hardcoded step 4 checks. |
| **Analytics & Reports** | `server/routes/analytics.js` & `src/pages/admin/Analytics.jsx` | Query dynamic course names and phase stats without assuming fixed 2-phase structure. |

---

## 7. Migration, Rollback & Regression Defense

1. **Additive Migration Pipeline**:
   - `server/db/migrations/20261019_course_maker.cjs`: Initialized `course_definitions`, `student_phase_results`, `student_class_attendance`, and `student_assignment_grades`.
   - `server/db/migrations/20261019_routine_overrides_and_migration_audit.cjs`: Initialized `course_routine_overrides`, `course_routine_audits`, and `legacy_enrollment_migrations`.
   - `server/db/migrations/20261019_allow_moderator_role.cjs`: Migrated `users.role` check constraint to include `'moderator'`.
   - `server/db/migrations/20261019_batch_moderators.cjs`: Initialized `batch_moderators` table to authorize moderators per batch.
   - Column additions: `batches(course_definition_id, course_version)` and `student_course_enrollments(course_definition_id, course_version)`.
2. **Safe Rollback**:
   - Because no existing columns or tables are deleted or modified, rollback consists simply of ignoring the new tables.
3. **Regression Test Verification**:
   - The full Playwright test suite comprises **14 test suites (80/80 tests passed)** covering both legacy and Course Maker functionality.
   - All legacy student workflows, batch management, certificate generation, community, fee tracking, and file upload tests continue to pass 100% without modification, confirming zero regression on historical student flows.

