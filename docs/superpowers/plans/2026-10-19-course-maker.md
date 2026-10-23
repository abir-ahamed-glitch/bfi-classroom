# Course Maker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, production-ready Course Maker admin interface and end-to-end integration for BFI Classroom supporting 1–5 dynamic phases, versioned definitions, concurrency-safe progress tracking, and 100% backward compatibility for existing students.

**Architecture:** A dedicated versioned course definition engine (`course_definitions`, `course_routine_audits`) with separate normalized progress tables (`student_phase_results`, `student_class_attendance`, `student_assignment_grades`) that avoids JSON race conditions and avoids dual-writing into two-phase legacy columns. An adapter layer cleanly distinguishes legacy enrollments (`course_definition_id IS NULL`) from defined course enrollments (`course_definition_id IS NOT NULL`), preserving all 911 verified historical student records without data loss.

**Tech Stack:** React (Vite), Express.js, SQLite (`better-sqlite3`), Socket.IO, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-19-course-maker-design.md`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/docs/superpowers/specs/2026-10-19-course-maker-design.md)

## Global Constraints
- Phase counts must strictly range between 1 and 5.
- Published definitions are immutable; updates require incrementing `version`.
- Routine updates have dedicated audit logging in `course_routine_audits`.
- Authoritative source per enrollment: legacy columns for legacy enrollments; normalized tables for defined courses. No lossy dual-writing.
- Preserve all existing 911 enrollments and 61 batches without schema breakage.
- All existing 55 Playwright tests must continue to pass with 0 regressions.

## Review Focus
1. Concurrency safety: simultaneous attendance or grading updates must not overwrite each other (handled by atomic row upserts).
2. Phase count boundary validation: rejecting phase counts < 1 or > 5 both on client and server.
3. Pass mark consistency: phase pass threshold cannot exceed total possible marks (exam max + assignments max).
4. Routine moderation RBAC: moderators can only edit routines where permitted and cannot alter course structure or grading.
5. Historical transcript safety: editing a course definition must not alter records of students enrolled in prior versions.

---

### Task 1: Database Migration & Schema Setup
**Files:**
- Create: `server/db/migrations/20261019_course_maker.js`
- Modify: `server/db/database.js`
- Test: `tests/course-maker-db.spec.js`

**Interfaces:**
- Consumes: `server/bfi_classroom.db`
- Produces: `course_definitions`, `course_routine_audits`, `student_phase_results`, `student_class_attendance`, `student_assignment_grades` tables, plus columns on `batches` and `student_course_enrollments`.

- [ ] **Step 1: Write migration script and test**
- [ ] **Step 2: Run migration on SQLite database**
- [ ] **Step 3: Verify existing 911 enrollments remain intact**

---

### Task 2: Backend Course Definitions API & Validation
**Files:**
- Create: `server/routes/course-definitions.js`
- Modify: `server/server.js`
- Test: `tests/course-definitions-api.spec.js`

**Interfaces:**
- Consumes: `course_definitions`, `course_routine_audits`, `users`
- Produces: `GET /api/admin/course-definitions`, `GET /api/admin/course-definitions/:id`, `POST /api/admin/course-definitions`, `PUT /api/admin/course-definitions/:id`, `POST /api/admin/course-definitions/:id/publish`, `PUT /api/admin/course-definitions/:id/routine`

- [ ] **Step 1: Write API tests for draft creation, validation rules, publish immutability, and routine editing**
- [ ] **Step 2: Implement validation middleware and route handlers in `server/routes/course-definitions.js`**
- [ ] **Step 3: Mount route in `server/server.js`**
- [ ] **Step 4: Run API tests and verify pass**

---

### Task 3: Progress Engine & Dual-Model Evaluation Service
**Files:**
- Create: `server/services/courseProgressService.js`
- Test: `tests/course-progress-service.spec.js`

**Interfaces:**
- Consumes: `student_course_enrollments`, `course_definitions`, `student_phase_results`, `student_class_attendance`, `student_assignment_grades`
- Produces: `getEnrollmentProgress(enrollmentId)`, `recordClassAttendance(...)`, `recordAssignmentGrade(...)`, `evaluatePhaseProgress(...)`, `evaluateCertificateEligibility(...)`

- [ ] **Step 1: Write service unit tests for legacy fallback vs defined evaluation**
- [ ] **Step 2: Implement atomic evaluation and grading logic with transaction safety**
- [ ] **Step 3: Run service tests and verify pass**

---

### Task 4: Backend Integration Across Existing Workflows
**Files:**
- Modify: `server/routes/admin.js`
- Modify: `server/routes/batches.js`
- Modify: `server/routes/student.js`
- Modify: `server/routes/certification.js`
- Modify: `server/routes/analytics.js`
- Modify: `server/utils/batchStatusAutomation.js`

- [ ] **Step 1: Update batch creation to accept `course_definition_id` and pin `course_version`**
- [ ] **Step 2: Update student profile and dashboard endpoints to deliver dynamic phase progress**
- [ ] **Step 3: Update certification eligibility checks to verify dynamic phase completion**
- [ ] **Step 4: Update analytics and batch automation engine for dynamic courses**

---

### Task 5: Frontend Course Maker UI
**Files:**
- Create: `src/pages/admin/CourseMaker.jsx`
- Modify: `src/pages/admin/AdditionalOptions.jsx`
- Modify: `src/components/Sidebar.jsx`
- Test: `tests/course-maker-ui.spec.js`

- [ ] **Step 1: Build 1–5 phase wizard with basics, phase tabs, routine, classes, assignments, exams, and completion policy**
- [ ] **Step 2: Build Review & Publish summary screen with client validation**
- [ ] **Step 3: Register in AdditionalOptions and Sidebar**

---

### Task 6: Frontend Integration Across Batches & Student Portal
**Files:**
- Modify: `src/components/admin/BatchFormModal.jsx`
- Modify: `src/pages/admin/BatchDetail.jsx`
- Modify: `src/pages/StudentPortal.jsx`
- Modify: `src/components/admin/EditStudentModal.jsx`

- [ ] **Step 1: Allow selecting published course definitions in BatchFormModal**
- [ ] **Step 2: Render dynamic phase columns and student grading in BatchDetail**
- [ ] **Step 3: Render dynamic 1–5 phases and progress in StudentPortal**

---

### Task 7: Comprehensive Verification & Regression Testing
**Files:**
- Create: `tests/course-maker-e2e.spec.js`
- Run: `npx playwright test`

- [ ] **Step 1: Run complete Course Maker E2E test suite**
- [ ] **Step 2: Run all 11 existing test suites (55 tests) to prove 0 legacy regressions**
- [ ] **Step 3: Run `npm run build` to verify frontend build integrity**

---

### Task 8: Final Review Report
**Files:**
- Create: `docs/reports/course-maker-implementation-report.md`

- [ ] **Step 1: Generate comprehensive report with architecture, clickable file links, real test evidence, checklist, and known limitations**
