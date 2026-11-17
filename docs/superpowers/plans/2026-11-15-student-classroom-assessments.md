# Student classroom and submissions implementation plan

Goal: Deliver a student dashboard class map, linked assessment submissions and future Zoom readiness while preserving Course Maker rules.

## Step 1 — Class map and attendance

- [x] Reuse the authenticated student schedule and Bangladesh time.
- [x] Render a horizontal timeline with today highlighted, selected-class details and navigation controls.
- [x] Map attendance for an unambiguous, explicitly dated class and a single matching enrollment. Leave ambiguous records unmarked.
- [x] Verify timeline and attendance mapping tests and existing Express regression.
- [x] Verify dashboard browser navigation, two enrolled courses and schedule updates in Chromium, Firefox and WebKit; exercise student-specific attendance isolation in the Express regression.
- [x] Link selected sessions to the corresponding Classroom batch and phase. Verified in Chromium, Firefox and WebKit mobile tests.
- [x] Allow an admin to configure an HTTPS meeting link for a batch routine; show it in the selected week's Classroom and explain when none is configured. Actual Zoom integration and attendance remain Step 4.

## Step 2 — Exam and assignment scheduling

- [x] Define and persist batch-specific assessment windows tied to a Course Maker phase and assessment identifier.
- [x] Provide admin controls and validate time, course and batch identity on the server.
- [x] Expose only the student's eligible assessment windows in Classroom, honoring admission, attendance, schedule changes and Dhaka time.
- [x] Test defined-course eligibility, legacy exclusion, duplicate identities, deadlines and authorization. Legacy enrollments are intentionally excluded until migrated to a Course Maker definition.

## Step 3 — Secure assessment submissions

- [x] Implement private, access-controlled PDF storage, metadata, size/type validation and submission history. PDFs are stored in the SQLite database so the existing database backup includes them.
- [x] Implement student PDF submission, status and receipt, preserving selected files in the open page on errors and retries.
- [x] Add multi-photo preview, rotation, reorder and deletion, then convert ordered images to a PDF.
- [x] Support assignment and exam submission and reviewer access in the correct batch.
- [x] Integrate grading through existing course progress rules and audit records.
- [x] Test permissions, unsafe inputs, partial failure, duplicate uploads, deadlines and progression.

Ruling: Draft images are kept in the open page, not persisted across refresh, to avoid leaving private answer papers in browser storage. Image conversion supports rotation and ordering; automatic cropping is not provided.

## Step 4 — Zoom readiness

- [x] Make Classroom navigation and meeting link handling use the selected session.
- [x] Design verified Zoom participant-to-enrollment mapping and deduplication around existing attendance services, including admin corrections; see `2026-11-16-zoom-attendance-readiness.md`.
- [ ] Implement and verify actual Zoom integration when a configured Zoom account and required credentials are available. The local `.env` has no Zoom-prefixed settings; no connected Zoom tool was available in this session. Production configuration was not inspected.

## Step 5 — Final verification

- [x] Run focused API, migration, course progression, attendance and cross-browser regressions.
- [x] Inspect the resulting work and report verified results and remaining limitations. Deployment requires a separate user instruction.

Ruling: Enrollment removal is blocked with a clear response when answer papers exist, preserving the records until a separately designed retention process is available. Independent review identified canonical phase, numeric assignment IDs and closed-window history issues; corrected and covered by local tests.
