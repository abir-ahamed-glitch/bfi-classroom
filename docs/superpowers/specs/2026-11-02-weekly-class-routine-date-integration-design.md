# Flexible Class Routine Date Integration & Batch Schedule Management — Design Spec

**Date:** 2026-11-02  
**Branch:** `feat/routine-date-and-batch-schedule`  
**Base Commit:** `f0ad1dcf4f7e28d03be96a21fda5db3cfeb057b8`  
**Status:** In Review — Pending User Approval  

---

## 1. Problem Statement & Operational Context

In the **BFI Classroom** Course Maker builder (`admin/course-maker?mode=builder`), the "Weekly Class Routine" configuration currently restricts routine slots to:
- `weekday` (dropdown: Saturday, Sunday, ..., Friday)
- `startTime` (`type="time"`, e.g., `18:00`)
- `endTime` (`type="time"`, e.g., `20:00`)

### Practical Deficiencies:
1. **Missing Calendar Date:** A routine without dates cannot specify exact calendar scheduling for workshops, weekend masterclasses, or phased curriculum milestones.
2. **Multiple Batches per Course:** A single Master Course Definition (e.g. *Filmmaking Fundamentals*) runs across dozens of distinct batches throughout the year. Each batch operates on its own timeline and calendar dates.
3. **Rescheduling & Institutional Independence:** As an independent institution, BFI schedules classes based on practical student/mentor availability—including on holidays, weekends, or weekdays. Routine slots frequently shift dates, weekdays, or times per batch.
4. **Lack of Batch-Level Routine Controls in UI:** While the database and service layer support batch-level routine overrides (`course_routine_overrides`), administrators currently lack a direct UI in the Batch Management portal (`BatchDetail.jsx`) to adjust dates and times for an active batch.

---

## 2. Core Design Principles

1. **Complete Administrative Freedom:** Zero hardcoded assumptions regarding "business days" or "holidays". Any calendar date, any day of the week (Saturday through Friday), and any time window can be selected.
2. **Progressive Enhancement & Backward Compatibility:** The `date` field in routine slots is optional. Existing courses and batches with weekday-only routines continue to function without data migration or disruption.
3. **Smart Synchronization:** Selecting a date (`YYYY-MM-DD`) automatically sets the matching weekday in the dropdown (e.g., selecting `2026-11-07` automatically selects `Saturday`), while keeping the weekday dropdown unlocked for full administrative control.
4. **Three-Tier Routine Hierarchy:**
   - **Tier 1 (Highest):** Batch-specific operational routine override (`course_routine_overrides` with `batch_id`).
   - **Tier 2:** Course-level operational override (`course_routine_overrides` with `batch_id = NULL`).
   - **Tier 3 (Base):** Master Course Definition routine (`definition_json`).

---

## 3. Data Model & Routine Schema Specification

### 3a. Routine Slot Structure
Each slot in a phase's `routine` array is structured as:
```typescript
interface RoutineSlot {
  date?: string;       // Optional ISO date: 'YYYY-MM-DD' (e.g. '2026-11-07')
  weekday: string;     // 'Saturday' | 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday'
  startTime: string;   // 'HH:mm' 24-hr format (e.g. '18:00')
  endTime: string;     // 'HH:mm' 24-hr format (e.g. '20:00')
  timezone?: string;   // Default: 'Asia/Dhaka'
}
```

### 3b. Database Storage (Zero Migration Invariant)
Routines are stored as serialized JSON strings in existing tables:
- `course_definitions.definition_json` (inside `phases[i].routine`)
- `course_routine_overrides.routine_json`
- `course_routine_audits.old_routine` and `new_routine`

Because SQLite stores these payloads as text, adding the optional `date` attribute requires **zero schema migrations**, preventing any risk of database downtime or locking.

---

## 4. UI & Component Architecture

### 4a. CourseMaker Builder (`src/pages/admin/CourseMaker.jsx`)
In the Phase Configuration view (`Weekly Class Routine` section):
1. **Slot Card Layout:**
   - **Row 1:** 
     - Date Picker input (`<input type="date" />`) with calendar icon. Placeholder / empty allowed.
     - Day Selector (`<select>`) containing all 7 weekdays.
     - Trash / Delete button (`cm-btn-danger-icon`).
   - **Row 2:**
     - Start Time input (`<input type="time" />`)
     - Separator label ("to")
     - End Time input (`<input type="time" />`)
2. **Auto-Weekday Detection:**
   - When `updateRoutineField(index, 'date', val)` is triggered:
     ```javascript
     if (val) {
       const [y, m, d] = val.split('-').map(Number);
       const dateObj = new Date(y, m - 1, d);
       const dayName = WEEKDAYS[dateObj.getDay() === 0 ? 1 : (dateObj.getDay() + 1) % 7]; // or standard lookup
       // Automatically syncs weekday state
     }
     ```
3. **Routine Audit Modal (for Published Courses):**
   - The same slot layout with the Date Picker is integrated into the CourseMaker Routine Audit modal, ensuring published curriculum modifications also track exact dates.

### 4b. Batch Detail Management (`src/pages/admin/BatchDetail.jsx`)
In Section 1B (*Defined Course Structure & Operational Routines*):
1. **"Adjust Routine" Action Button:**
   - Rendered on each phase card: `[ ✏️ Adjust Batch Routine ]`.
2. **Batch Routine Adjustment Modal (`BatchScheduleModal`):**
   - Opens when the administrator clicks "Adjust Batch Routine".
   - Displays the current phase's operational routine slots (loaded from batch override if present, else course default).
   - Enables:
     - Changing or adding specific dates (`YYYY-MM-DD`).
     - Changing days or time windows.
     - Adding (`+ Add Slot`) or removing slots.
     - Requiring an audit reason (e.g. *"Class rescheduled due to special shooting schedule"*).
   - Sends `PUT /api/course-definitions/:id/routine` with:
     ```json
     {
       "phase_id": "phase_1",
       "batch_id": 12,
       "routine": [...],
       "reason": "Class rescheduled due to special shooting schedule"
     }
     ```
3. **Read-Only Routine Display Badges:**
   - If slot has `date`: Displays `📅 07 Nov 2026 (Saturday) • 07:00 PM – 08:00 PM`
   - If slot has no date: Displays `📅 Every Saturday • 07:00 PM – 08:00 PM`
   - Tagged with `Batch Schedule` (blue) if overridden, or `Course Default` (neutral).

### 4c. CSS & Responsive Design (`src/pages/admin/CourseMaker.css`)
- Clean layout using CSS flexbox/grid.
- On viewports `<= 480px` or `<= 360px`, controls wrap into neat stacked rows with minimum 44px touch targets.
- Preserves dark mode and light mode glassmorphism themes.

---

## 5. Backend Validation & Service Layer

### 5a. Route Validation (`server/routes/course-definitions.js`)
In `PUT /api/course-definitions/:id/routine` and `POST /api/course-definitions`:
- Accept optional `date` in each routine slot.
- If provided, validate format: `/^\d{4}-\d{2}-\d{2}$/` and valid calendar date.
- Validate `startTime < endTime`.
- Check for overlapping schedules within the same date/day.
- Record `changed_by`, `reason`, `batch_id`, and full old/new JSON in `course_routine_audits`.

### 5b. Resolution Logic (`server/services/courseProgressService.js`)
- `resolvePhaseRoutine` preserves slot `date` attributes when returning routine payloads to API consumers (batch details, student portals, etc.).

---

## 6. Verification and Testing Strategy

1. **Unit & Regression Suites:**
   - Create `scripts/test_course_routine_date.cjs` testing:
     - Routine slot validation with valid ISO date, null/empty date, and invalid date formats.
     - Routine slot overlapping detection when dates differ vs when dates match.
     - Precedence hierarchy: batch override with date overrides course baseline.
     - Audit logging: `course_routine_audits` captures date changes and reason.
2. **Full Regression Inventory:**
   - Execute all 29 existing project test suites (`scripts/test_*.cjs`) to guarantee 100% green status with zero regressions.
3. **Manual Interactive Verification:**
   - Create and modify routine slots in CourseMaker builder mode.
   - Adjust routine for a specific batch in BatchDetail and verify the override badge and display.
