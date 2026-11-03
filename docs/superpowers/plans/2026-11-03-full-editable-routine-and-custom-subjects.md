# Full Editable Routine Slots & Custom Subjects Auto-Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Weekly Class Routine slots to support full in-place editing of Subject, Class/Topic Title, Teacher, Delivery Mode, and Category across CourseMaker and BatchDetail, and automatically populate the Subject selection choices dynamically from custom subjects created in "Create Custom Subject".

**Architecture:** Extend backend validation in `course-definitions.js` to preserve slot metadata (`subjectName`, `classTitle`, `teacherName`, `deliveryMode`, `category`) without database schema migrations. Expose and synchronize `custom_subjects` catalog in both CourseMaker and BatchDetail. Add full editing controls, "Select from Phase Classes" quick-fill, and rich readable routine badges in BatchDetail.

**Tech Stack:** Node.js, Express, SQLite (better-sqlite3), React 19, Lucide React, Vite, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-11-03-full-editable-routine-and-custom-subjects-design.md`

## Global Constraints

- Full administrative freedom: any field (Date, Day, Time, Subject, Title, Teacher, Mode, Category) can be edited or overridden at any time.
- Dynamic Catalog Sync: Any subject created or updated in `/admin/additional-options?view=custom-subjects` (`Create Custom Subject`) must immediately be available in the Subject selection datalists.
- Backward compatibility: existing routine slots with only dates/weekdays continue working seamlessly; missing metadata defaults gracefully.
- Zero database migrations: all routine slot metadata serializes within existing JSON columns.
- UI Movement Standards: no hover translateY or zoom transforms.
- All 30 existing project test suites (`scripts/test_*.cjs`) must pass with exit code 0.

## Review Focus

1. **Custom Subject Datalist Availability:** When a new custom subject is inserted into `custom_subjects`, both CourseMaker and BatchDetail routine slots show it in the datalist.
2. **Metadata Persistence:** Updating a batch routine with Subject, Topic, Teacher, Mode, and Category preserves all fields in `course_routine_overrides` and `course_routine_audits`.
3. **Phase Class Pre-fill:** Selecting an existing phase class from the helper dropdown populates all fields into the routine slot while leaving them unlocked for manual editing.
4. **Validation Integrity:** Backend safely validates optional deliveryMode and category strings if supplied without crashing on legacy slots.
5. **Mobile Responsiveness:** All slot editing controls wrap cleanly on mobile screens (`<= 480px`) with touch targets >= 44px.

---

### Task 1: Backend Route Validation & Schema Extension for Slot Metadata

**Files:**
- Modify: `server/routes/course-definitions.js`
- Test: `scripts/test_course_routine_date.cjs`

**Interfaces:**
- Consumes: `PUT /api/course-definitions/:id/routine`, `POST /api/course-definitions`
- Produces: Sanitized and validated routine slots carrying `subjectName`, `classTitle`, `teacherName`, `deliveryMode`, `category`.

- [ ] **Step 1: Update unit test `scripts/test_course_routine_date.cjs`**

Add assertions verifying routine slot submission with full metadata:
```javascript
const fullSlot = {
  date: '2026-11-07',
  weekday: 'Saturday',
  startTime: '18:00',
  endTime: '20:00',
  timezone: 'Asia/Dhaka',
  subjectName: 'Cinematography',
  classTitle: 'Master Shot & Lighting Angles',
  teacherName: 'Abir Ahmad',
  deliveryMode: 'online',
  category: 'practical'
};
// Assert PUT accepts and stores all fields, and audits record contains full snapshot
```

- [ ] **Step 2: Run test to check current behavior**

Run: `node scripts/test_course_routine_date.cjs`  
Expected: Test runs and identifies any field stripping or validation errors.

- [ ] **Step 3: Update `server/routes/course-definitions.js`**

In routine slot validation (around line 110 and 840):
- Allow optional `slot.subjectName` (string).
- Allow optional `slot.classTitle` (string).
- Allow optional `slot.teacherName` (string).
- If `slot.deliveryMode` is present, validate against `ALLOWED_DELIVERY_MODES`.
- If `slot.category` is present, validate against `ALLOWED_CATEGORIES`.
- Ensure clean JSON serialization into `course_routine_overrides` and `course_routine_audits`.

- [ ] **Step 4: Run unit test to verify it passes**

Run: `node scripts/test_course_routine_date.cjs`  
Expected: PASS (All assertions pass, exit code 0).

- [ ] **Step 5: Commit**

```bash
git add server/routes/course-definitions.js scripts/test_course_routine_date.cjs
git commit -m "feat(api): support subject, teacher, and class metadata in routine slot validation"
```

---

### Task 2: CourseMaker Builder Slot UI & Dynamic Custom Subjects Auto-Sync

**Files:**
- Modify: `src/pages/admin/CourseMaker.jsx:680-720, 1690-1760`
- Modify: `src/pages/admin/CourseMaker.css`
- Test: `npm run build`

**Interfaces:**
- Consumes: `subjects` (from `GET /api/admin/custom-subjects`), `teachers` (from `GET /api/admin/teachers`), `curPhase.classes`
- Produces: Rich routine slot editor with quick-fill from phase classes and fully editable fields.

- [ ] **Step 1: Update routine slot creation helper in `CourseMaker.jsx`**

In `addRoutineToPhase`:
- Initialize `newSlot` with:
  `{ date: '', weekday: 'Saturday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka', subjectName: '', classTitle: '', teacherName: '', deliveryMode: 'online', category: 'theory' }`.

- [ ] **Step 2: Render full editable slot card in CourseMaker routine section**

In `.cm-routine-slot-row` / card:
- Quick-fill selector: `<select onChange={e => copyFromPhaseClass(rIdx, e.target.value)}>Select from Phase Classes...</select>`
- Row 1: Date picker (`type="date"`), Weekday select (`Saturday`–`Friday`), Start time, End time, Delete button (`Trash2`).
- Row 2: Subject input with `list="subject-suggestions"`, Class Title input (`placeholder="Class Title / Topic"`).
- Row 3: Teacher input with `list="teacher-suggestions"`, Delivery Mode dropdown (`Live Online`, `In-Person`, `Hybrid`), Category dropdown (`Theory`, `Practical`, `Shooting`, `Editing`, `Review`).

- [ ] **Step 3: Add CSS styles in `CourseMaker.css`**

Add responsive styling for multi-row routine slot cards with 44px min-height inputs and glassmorphic backgrounds.

- [ ] **Step 4: Verify frontend build compiles cleanly**

Run: `npm run build`  
Expected: Build succeeds with exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/CourseMaker.jsx src/pages/admin/CourseMaker.css
git commit -m "feat(course-maker): full editable routine slots with phase class quick-fill and custom subject datalist"
```

---

### Task 3: CourseMaker Routine Audit Modal Full Slot Editing

**Files:**
- Modify: `src/pages/admin/CourseMaker.jsx:2580-2650`
- Test: `npm run build`

**Interfaces:**
- Consumes: `auditRoutineList`, `subjects`, `teachers`, `auditModalDef`
- Produces: Complete slot editing capabilities in published routine audit modal.

- [ ] **Step 1: Add full metadata fields to audit modal slot editor**

In `cm-modal-routine-slot`:
- Quick-fill dropdown from target phase classes.
- Subject input with custom subjects datalist.
- Class Title input.
- Teacher input with teachers datalist.
- Delivery Mode and Category selects.

- [ ] **Step 2: Verify build compiles cleanly**

Run: `npm run build`  
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/CourseMaker.jsx
git commit -m "feat(course-maker): add full editable metadata controls to published routine audit modal"
```

---

### Task 4: BatchDetail Schedule Modal & Display Badges with Live Catalog Integration

**Files:**
- Modify: `src/pages/admin/BatchDetail.jsx`
- Modify: `src/pages/admin/BatchDetail.css`
- Test: `npm run build`

**Interfaces:**
- Consumes: `/api/admin/custom-subjects`, `/api/admin/teachers`, `PUT /api/course-definitions/:id/routine`
- Produces: Live catalog integration, full slot editor in `BatchScheduleModal`, and formatted display badges in Section 1B.

- [ ] **Step 1: Fetch custom subjects and teachers in `BatchDetail.jsx`**

Add state `catalogSubjects` and `catalogTeachers`.
Fetch on mount / modal open from `/api/admin/custom-subjects` and `/api/admin/teachers`.

- [ ] **Step 2: Update `BatchScheduleModal` in `BatchDetail.jsx`**

In the modal:
- Datalists for `batch-routine-subject-suggestions` and `batch-routine-teacher-suggestions`.
- Quick-fill dropdown from `editingRoutinePhase.classes`.
- Full input rows: Date, Day, Time, Subject, Class Title, Teacher, Delivery Mode, Category.
- All fields fully editable.

- [ ] **Step 3: Update Section 1B Routine Display Badges**

Render detailed slot card:
- Line 1: `📅 Date (Weekday) • StartTime–EndTime`
- Line 2 (if subject or title present): `📚 Subject: [Subject] • 🎬 Class: [Title]`
- Line 3 (if teacher or mode present): `👨‍🏫 Teacher: [Teacher] • 🏷️ [Mode] ([Category])`

- [ ] **Step 4: Verify build compiles cleanly**

Run: `npm run build`  
Expected: Build succeeds with exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/BatchDetail.jsx src/pages/admin/BatchDetail.css
git commit -m "feat(batches): integrate custom subjects catalog and full editable schedule slots in batch management"
```

---

### Task 5: End-to-End Regression Verification across 30 Suites, Build & Git Push

**Files:**
- Run: all 30 `scripts/test_*.cjs` suites
- Run: `npm run build`
- Git: Push to `upstream feat/routine-date-and-batch-schedule`

**Interfaces:**
- Consumes: Test runner, Vite build, GitHub PR #11.
- Produces: 100% green verification, clean working tree, and updated PR.

- [ ] **Step 1: Run all 30 test suites**

Run:
```powershell
Get-ChildItem scripts/test_*.cjs | ForEach-Object { node $_.FullName }
```
Expected: All 30 test suites pass `exit 0`.

- [ ] **Step 2: Run frontend production build**

Run: `npm run build`  
Expected: Clean build, 0 errors.

- [ ] **Step 3: Commit ledger and push to upstream**

```bash
git push upstream feat/routine-date-and-batch-schedule
```
Expected: PR #11 updated with all new capabilities.
