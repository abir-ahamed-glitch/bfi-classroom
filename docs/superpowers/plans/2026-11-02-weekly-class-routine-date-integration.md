# Flexible Class Routine Date Integration & Batch Schedule Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate optional calendar dates into CourseMaker's Weekly Class Routine slots, auto-synchronize weekdays while maintaining full admin freedom, and provide a batch-level routine override modal in BatchDetail for per-batch date, day, and time adjustments.

**Architecture:** Extend the routine slot schema `{ date?: string, weekday: string, startTime: string, endTime: string, timezone: string }` without database schema migrations. Update `course-definitions.js` route validation, add date input controls and auto-weekday sync in `CourseMaker.jsx`, and introduce an accessible `BatchScheduleModal` in `BatchDetail.jsx` wired to the 3-tier precedence hierarchy (`course_routine_overrides`).

**Tech Stack:** Node.js, Express, SQLite (better-sqlite3), React 19, Lucide React, Vite, CSS Modules / Glassmorphism.

**Spec:** `docs/superpowers/specs/2026-11-02-weekly-class-routine-date-integration-design.md`

## Global Constraints

- Zero hardcoded assumptions on class days or holiday restrictions; full institutional freedom for BFI.
- Backward compatibility: routine `date` is optional (`YYYY-MM-DD`); existing courses and batches without dates continue functioning normally.
- Zero database migrations: all routine data is stored in existing SQLite JSON columns (`definition_json`, `course_routine_overrides.routine_json`, `course_routine_audits`).
- Mobile responsiveness: all routine input rows must wrap cleanly on mobile screens (`<= 480px` and `<= 360px`) with touch targets `>= 44px`.
- Audit integrity: all routine changes (course-level and batch-level) must log actor, reason, and full old/new snapshots to `course_routine_audits`.
- All 29 existing project test suites (`scripts/test_*.cjs`) must maintain 100% green exit code 0 status.

## Review Focus

- Malformed date string (e.g. `2026-02-31` or `not-a-date`): backend rejects with HTTP 400 and clear error message.
- Overlapping time slots on the same date: properly flagged, but identical times on *different* dates are allowed.
- Weekday desynchronization: admin manually picking Sunday when date is Saturday remains allowed (unrestricted freedom).
- Batch override precedence: a batch with a date override completely takes precedence over the course definition baseline in `BatchDetail` and progress calculations.
- Empty or deleted date: removing a date restores standard recurring weekly routine behavior without error.

---

### Task 1: Backend Route Validation & Routine Date Support

**Files:**
- Modify: `server/routes/course-definitions.js`
- Test: `scripts/test_course_routine_date.cjs`

**Interfaces:**
- Consumes: `PUT /api/course-definitions/:id/routine`, `POST /api/course-definitions`
- Produces: Backend validation allowing optional `slot.date` (`YYYY-MM-DD`), saving to `course_routine_overrides` and `course_routine_audits`.

- [ ] **Step 1: Write the failing unit test `scripts/test_course_routine_date.cjs`**

```javascript
// Test valid routine with date, invalid date format rejection, overlapping logic by date, and audit trail capture
const assert = require('assert');
// Test harness asserts PUT /api/course-definitions/:id/routine accepts { date: '2026-11-07', weekday: 'Saturday', startTime: '18:00', endTime: '20:00' }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test_course_routine_date.cjs`  
Expected: FAIL (script does not exist or route rejects date)

- [ ] **Step 3: Implement validation in `server/routes/course-definitions.js`**

Add date format validation in `server/routes/course-definitions.js` around lines 105 and 830:
- If `slot.date` is present:
  - Verify regex `/^\d{4}-\d{2}-\d{2}$/` and valid date `!isNaN(new Date(slot.date).getTime())`.
- Update overlap check: slots overlap only if they have the same date (or neither has date and weekdays match) and their time ranges intersect.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test_course_routine_date.cjs`  
Expected: PASS (All assertions executed, exit code 0)

- [ ] **Step 5: Commit**

```bash
git add server/routes/course-definitions.js scripts/test_course_routine_date.cjs
git commit -m "feat(api): support optional date in routine slot validation and overrides"
```

---

### Task 2: CourseMaker Builder Date Input & Auto-Weekday Synchronization

**Files:**
- Modify: `src/pages/admin/CourseMaker.jsx:675-700`
- Modify: `src/pages/admin/CourseMaker.jsx:1660-1715`
- Modify: `src/pages/admin/CourseMaker.css:610-635`
- Test: `npm run build`

**Interfaces:**
- Consumes: `form.phases[activePhaseTab].routine`, `updateCurrentPhase`, `WEEKDAYS`
- Produces: UI with Date picker, Day dropdown, Time inputs, and auto-sync logic.

- [ ] **Step 1: Update routine helpers in `src/pages/admin/CourseMaker.jsx`**

In `addRoutineToPhase`:
- Initialize `newSlot` with `{ date: '', weekday: 'Saturday', startTime: '18:00', endTime: '20:00', timezone: 'Asia/Dhaka' }`.

In `updateRoutineField`:
- When `field === 'date'` and value is provided:
  - Parse date components `[y, m, d] = val.split('-').map(Number)`
  - Compute day of week: `const dObj = new Date(y, m - 1, d); const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dObj.getDay()]`
  - Update both `date: val` and `weekday: dayName`.

- [ ] **Step 2: Update routine slot rendering in `src/pages/admin/CourseMaker.jsx`**

Render a dedicated date picker input:
```jsx
<input
  type="date"
  value={rt.date || ''}
  onChange={(e) => updateRoutineField(rIdx, 'date', e.target.value)}
  className="cm-routine-date-input"
  aria-label="Class Date"
/>
```
Positioned cleanly before the weekday select in `.cm-routine-slot-row`.

- [ ] **Step 3: Update CSS styling in `src/pages/admin/CourseMaker.css`**

Add styling for `.cm-routine-date-input`:
- Matches dark/light mode glass input styling (`background: rgba(255,255,255,0.06)`, border, border-radius 6px, color `var(--text-primary)`).
- Touch target min-height 44px.
- Responsive breakpoints ensuring clean flex wrapping on mobile (`<= 480px`).

- [ ] **Step 4: Verify frontend build compiles cleanly**

Run: `npm run build`  
Expected: Build succeeds with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/CourseMaker.jsx src/pages/admin/CourseMaker.css
git commit -m "feat(course-maker): add date picker with auto-weekday sync to weekly routine builder"
```

---

### Task 3: CourseMaker Routine Audit Modal Date Support

**Files:**
- Modify: `src/pages/admin/CourseMaker.jsx:2565-2615`
- Test: `npm run build`

**Interfaces:**
- Consumes: `auditRoutineList`, `setAuditRoutineList`
- Produces: Published course routine audit modal with date picker and auto-sync.

- [ ] **Step 1: Add Date input in Audit Modal slot row**

In `CourseMaker.jsx` (`cm-modal-routine-slot`):
- Add `<input type="date" value={slot.date || ''} ... />`.
- When changed, auto-update both `slot.date` and `slot.weekday`.

- [ ] **Step 2: Verify build and modal behavior**

Run: `npm run build`  
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/CourseMaker.jsx
git commit -m "feat(course-maker): support dates in published course routine audit modal"
```

---

### Task 4: BatchDetail Batch-Specific Routine Override Modal & Display Badges

**Files:**
- Modify: `src/pages/admin/BatchDetail.jsx:1360-1400`
- Test: `npm run build`

**Interfaces:**
- Consumes: `batchData.course_definition.definition.phases`, `PUT /api/course-definitions/:id/routine`
- Produces: `BatchRoutineModal` component for batch routine customization, and formatted display badges with dates.

- [ ] **Step 1: Update routine display in `BatchDetail.jsx`**

Format routine display:
```jsx
{slot.date ? (
  <span className="batch-routine-date-pill">
    <Calendar size={12} /> {formatDate(slot.date)} ({slot.weekday}): {formatTime(slot.startTime)}–{formatTime(slot.endTime)}
  </span>
) : (
  <span>
    <Calendar size={12} /> Every {slot.weekday}: {formatTime(slot.startTime)}–{formatTime(slot.endTime)}
  </span>
)}
```

- [ ] **Step 2: Add "Adjust Batch Routine" button and modal state**

- Add state `const [editingRoutinePhase, setEditingRoutinePhase] = useState(null)` and `const [batchRoutineSlots, setBatchRoutineSlots] = useState([])`.
- Add button `<button onClick={() => openBatchRoutineModal(p)}>Adjust Routine</button>`.

- [ ] **Step 3: Implement `BatchRoutineModal` in `BatchDetail.jsx`**

- Loads phase's current routine (overridden or default).
- Allows adding, editing (Date, Day, Time), deleting slots.
- Form field for mandatory audit reason: `Reason for batch routine update *`.
- On save, calls `PUT /api/course-definitions/:defId/routine` with `{ phase_id, batch_id, routine, reason }`.
- Refreshes batch data and shows success toast.

- [ ] **Step 4: Verify build compiles cleanly**

Run: `npm run build`  
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/BatchDetail.jsx
git commit -m "feat(batches): add batch-specific routine adjustment modal and date display badges"
```

---

### Task 5: End-to-End Regression Verification across 29 Suites

**Files:**
- Run: all `scripts/test_*.cjs` (30 suites including new `test_course_routine_date.cjs`)
- Run: `npm run build`

**Interfaces:**
- Consumes: Full workspace test suites and Vite build pipeline.
- Produces: 100% green exit code 0 confirmation and clean production build assets.

- [ ] **Step 1: Run all backend and integration test suites**

Run:
```powershell
Get-ChildItem scripts/test_*.cjs | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw "Suite failed: $_" } }
```
Expected: All 30 suites pass `exit 0`.

- [ ] **Step 2: Run frontend production build**

Run: `npm run build`  
Expected: Vite build exits 0, `dist/` updated.

- [ ] **Step 3: Verify working tree clean**

Run: `git status --porcelain`  
Expected: Working tree clean.

- [ ] **Step 4: Commit and finalize feature branch**

```bash
git commit --allow-empty -m "chore(release): complete weekly class routine date integration and batch schedule verification"
```
