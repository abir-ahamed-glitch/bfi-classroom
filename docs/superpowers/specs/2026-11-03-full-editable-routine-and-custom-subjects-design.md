# Full Editable Routine Slots & Custom Subjects Auto-Integration Design

**Author:** Antigravity Pairing Assistant  
**Date:** 2026-11-03  
**Status:** Approved by User  
**Target Worktree:** `E:\Antigravity\Project 2 - BFI Classroom\.worktrees\super-admin-integration`  
**Feature Branch:** `feat/routine-date-and-batch-schedule` (PR #11)

---

## 1. Problem Statement & Motivation

Previously, BFI Classroom's "Weekly Class Routine" slots only tracked temporal coordinates (`date`, `weekday`, `startTime`, `endTime`, `timezone`). In real-world institutional administration at Bangladesh Film Institute (BFI), a class routine is incomplete without knowing:
1. **What subject is being taught?** (e.g. *Cinematography, Script, Film Language*).
2. **What is the class/topic title?** (e.g. *Master Shot & Lighting Angles*).
3. **Who is teaching?** (e.g. *Abir Ahmad, Kawsar Ahamed*, or a guest instructor).
4. **What is the class format?** (e.g. *Live Online, Physical Studio, Shooting Session, Editing Session, Theory, Practical*).

Furthermore, subjects dynamically created or managed by administrators in **Additional Options > Custom Subjects** (`Create Custom Subject`) must automatically populate the subject selection choices when scheduling any class or routine.

---

## 2. Architecture & Data Model

### 2.1 Routine Slot Schema (Backward-Compatible Extension)

Each routine slot across course definitions, draft phases, operational batch overrides, and audit trails expands to:

```typescript
interface RoutineSlot {
  id?: string;
  date?: string;             // Optional YYYY-MM-DD
  weekday: string;           // 'Saturday' | 'Sunday' | ... | 'Friday'
  startTime: string;         // 'HH:MM' (24-hour)
  endTime: string;           // 'HH:MM' (24-hour)
  timezone?: string;         // 'Asia/Dhaka'
  subjectName?: string;      // Name of subject (from custom_subjects or custom entry)
  classTitle?: string;       // Specific class title or topic name
  teacherName?: string;      // Assigned instructor name
  deliveryMode?: string;     // 'online' | 'offline' | 'hybrid' | 'self_paced'
  category?: string;         // 'theory' | 'practical' | 'shooting' | 'editing' | 'review'
}
```

### 2.2 Storage & Migrations
- **Zero Database Schema Migrations:** All routine slot metadata serializes within existing JSON columns:
  - `course_definitions.definition_json` (phases array)
  - `course_routine_overrides.routine_json`
  - `course_routine_audits.old_routine` and `new_routine`
- Older slots without these fields will default gracefully to empty strings.

---

## 3. Component Details & User Experience

### 3.1 Custom Subjects Dynamic Catalog Integration
- **Endpoint:** `GET /api/admin/custom-subjects` queries table `custom_subjects` (with teacher name and avatar join).
- **Auto-Sync:** 
  - `CourseMaker.jsx` already invokes `fetchCatalogs()`. It now exposes this catalog to routine slots.
  - `BatchDetail.jsx` adds `fetchCatalogs()` on component mount and modal open to fetch `/api/admin/custom-subjects` and `/api/admin/teachers`.
  - As soon as an admin creates a new subject in `/admin/additional-options?view=custom-subjects`, the subject is saved to `custom_subjects` and is instantly available in the datalist suggestions.

### 3.2 "Select from Phase Classes" Quick-Fill
- When a routine slot is added or edited in a Phase:
  - An optional dropdown `<select>` lists all defined classes in that phase: `Select from Phase Classes...`.
  - Selecting a class automatically pre-fills:
    - `classTitle = selectedClass.title`
    - `subjectName = selectedClass.subjectName`
    - `teacherName = selectedClass.teacherName`
    - `deliveryMode = selectedClass.deliveryMode`
    - `category = selectedClass.category`
  - **Crucial Rule:** All fields remain completely unlocked so administrators can edit any value (e.g. swap the teacher for a special guest, change mode from Online to Shooting Studio).

### 3.3 Full In-Place Editing Controls in Every Slot
Each routine slot card in `CourseMaker` and `BatchDetail` renders:
1. **Row 1 (Temporal):**
   - Date picker (`type="date"`, auto-syncs weekday on change).
   - Weekday dropdown (`Saturday` to `Friday`, manually overridable).
   - Time inputs (`type="time"` for start and end).
   - Delete button (`Trash2`).
2. **Row 2 (Subject & Topic):**
   - Subject input with `<datalist id="...-subject-suggestions">` populated from `custom_subjects`.
   - Class / Topic Title input (or quick-fill from Phase Classes).
3. **Row 3 (Instructor & Format):**
   - Teacher input with `<datalist id="...-teacher-suggestions">` populated from registered teachers.
   - Delivery Mode dropdown (`Live Online`, `In-Person / Physical Studio`, `Hybrid`, `Self Paced`).
   - Category dropdown (`Theory`, `Practical`, `Shooting Session`, `Editing Session`, `Exam / Review`).

### 3.4 Section 1B Batch Display Badges in `BatchDetail.jsx`
Batch detail phase cards format routine slots into informative badges:
```
┌────────────────────────────────────────────────────────────────────────┐
│ 📅 2026-11-07 (Saturday) • 07:00 PM – 09:00 PM                         │
│ 📚 Subject: Cinematography | 🎬 Topic: Master Shots & Camera Angles     │
│ 👨‍🏫 Teacher: Abir Ahmad    | 🏷️ Live Online (Practical)                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Verification & Testing Standards

1. **Unit Test Suite (`scripts/test_course_routine_date.cjs`):**
   - Expand assertions to verify `subjectName`, `classTitle`, `teacherName`, `deliveryMode`, and `category` survive `PUT /api/course-definitions/:id/routine` roundtrip and audit recording.
2. **Full Regression Test Suite:**
   - Run all 30 project test suites (`scripts/test_*.cjs`) and verify 100% green exit code 0.
3. **Production Build:**
   - Execute `npm run build` and verify clean compilation without bundle errors.
