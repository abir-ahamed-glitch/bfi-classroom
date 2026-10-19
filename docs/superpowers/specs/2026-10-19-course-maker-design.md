# Course Maker design

## Purpose and scope

Give an admin a form for defining a new film course or workshop before enrolling students. The first delivery is a usable course definition form and saved definition, with a clear preview of its rules. Existing batches, enrollments, attendance, marks, and certificates must keep working. Applying every new rule automatically to existing student workflows is a later integration step and must not be implied by the form.

## Existing system

`CourseSettingsManager` currently stores a course name, batch, class count, exam marks, assignments, and a Phase 2 flag. `custom_subjects` stores course/phase subjects, teacher, live or recorded type, duration, and live Q&A. `student_course_enrollments` contains legacy Phase 1 and Phase 2 result fields. Course Settings and student calculations currently assume at most two phases and some paths special-case Online Filmmaking Course. The new definition therefore needs its own model; it must not silently replace those legacy values.

## Chosen approach

Add a dedicated Course Maker screen under Additional Options, backed by a separate `course_definitions` record containing a validated, versioned JSON definition. Show existing subjects and teachers as selectable suggestions and allow a new subject title in the form. Do not mutate the shared subject catalog merely by saving a draft. This keeps a course template separate from batch overrides and avoids rewriting legacy grading logic before the form can be reviewed.

Alternatives considered: expanding the existing Course Settings row would overload its Phase 1 fields and Phase 2 boolean; creating many normalized tables immediately would add migration complexity before the form model is settled. A versioned definition gives a small, explicit first step and leaves room for later student integration.

## Form flow

1. **Course basics:** course or workshop name, type, description, duration value and unit, and phase count (1–5; default 2).
2. **One section per phase:** phase title, description, class count, whether class completion and attendance are required, minimum attendance percentage when required, and weekly routine. A routine entry has weekday, start/end time, and timezone. Admins and moderators can later edit routine entries without changing marks. Routine changes must have an audit trail once scheduling is connected to actual batches.
3. **Classes:** each class has title, subject (existing catalog suggestion or typed title), teacher (existing teacher where available), delivery mode (`live`, `recorded`, or `recorded_with_live_discussion`), duration, mandatory flag, and optional schedule details. Phase 2 can also label practical classes as shooting or editing; these are class categories, not hard-coded phase rules.
4. **Assignments:** zero or more per phase. Each has stable ID, title, subject, instructions/details, max marks, and whether submission is required. The form shows the running assignment maximum.
5. **Exam and grading:** optional exam per phase, exam title/type, maximum and pass marks, whether assignment marks contribute to phase total, and phase pass threshold. Show an explicit marks summary so pass logic is understandable. Validate that thresholds cannot exceed available marks.
6. **Completion rules:** certificate eligibility requires every required phase to pass and any required attendance/classes/assignments to be complete. On failure, the form records re-enrollment as the recovery path and an optional percentage discount, defaulting to 50% only when enabled. Recording this policy does not automatically issue discounts or certificates in this first delivery.
7. **Review and save:** show all phases and rules in a read-only summary. Save draft or publish the definition. Publish requires valid basics and valid enabled grading rules; drafts may be incomplete. Editing a published definition should create a new version so historical student rules can remain stable when integration is added.

## Data and interfaces

Store `id`, `slug`, `name`, `status`, `schema_version`, `definition_json`, `created_by`, `updated_by`, timestamps, and a monotonically increasing version. Enforce unique slug/version and one current published version per slug. Server endpoints for admin: list, read, create draft, update draft, publish. Moderator access is limited to reading definitions and future routine changes; course structure and grading remain admin-only. Validate all payloads server-side (lengths, numeric ranges, phase count, IDs, routine times, mark totals). Return field-level validation errors. Reject unknown schema versions rather than guessing.

Subject and teacher selectors use existing `/api/admin/custom-subjects` and `/api/admin/teachers` data where authorized. A selected catalog item stores its ID and a name snapshot; typed subject names store only the name. This avoids losing a course label if a catalog item changes.

## Student connection and rollout

The form's definitions will be available for later batch assignment. On that integration, pin each enrollment to a published definition version, store attendance and marks by phase/class/assignment IDs, and calculate phase and certificate status from that pinned version. Do not infer a student's status from the latest editable definition. Existing enrollments remain on the legacy calculations until explicitly migrated, with migration and regression checks. The form UI must label policies as saved definitions rather than active automated student rules until this integration exists.

## Error handling and verification

Keep entered values on failed save, show the specific field errors, and prevent a second submit while saving. Warn before reducing phase count if the removed phases contain data. Verify phase count changes, conditional fields, dynamic classes/assignments, totals and threshold validation, saved draft reload, publish validation, and authorization. Run the project build and relevant tests. Check that existing Course Settings and student results remain unchanged.
