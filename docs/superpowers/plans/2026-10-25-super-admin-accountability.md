# Super Admin Accountability & Fail-Closed Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement comprehensive administrator accountability (dashboard, individual profiles, dual timelines, creator attribution, operational activity ledger across modules, Asia/Dhaka timestamps, secret redaction, and access isolation) and close all remaining fail-open paths in the maintenance preflight gate.

**Architecture:** Extend SQLite database with creator attribution (`users.created_by_admin_id`) and expanded operational audit columns (`module`, `resource`, `outcome`, `correlation_id`, `before_state`, `after_state`). Provide a central audit ledger service enforcing transactional atomicity and OWASP Logging Cheat Sheet secret redaction. Refactor `scripts/preflight_lockdown_check.cjs` with dependency injection, direct process spawning (`shell: false`), and strict stderr/code validation to eliminate fail-open risks. Expand `AdminManagement.jsx` with an Accountability Dashboard, Individual Profile views with dual timelines, and an enhanced Audit Ledger.

**Tech Stack:** Node.js, Express 5, Better-SQLite3, React 19, Lucide React, Playwright, ESLint, Vite.

**Spec:** Acceptance Requirements defined in user request:
- Maintenance gate: Reject PM2 errors/timeouts/malformed JSON, detect lsof/fuser reliably, distinguish "no handles" from permission denial, avoid shell invocation, test via dependency injection.
- Administrator accountability: Dashboard (counts, date range, creator breakdown), individual profile (identity, creator attribution, status, permissions history, dual timelines, security history), operational activity ledger across modules, OWASP Logging Cheat Sheet compliance, Asia/Dhaka formatting, Super Admin restriction.

## Global Constraints
- Zero hover movement or zoom (`<RULE[user_global]>`).
- Do not modify production database `server/bfi_classroom.db` (disposable databases only).
- Do not commit to `main`, push to `origin`, or restart production services.
- Never invent a creator for legacy accounts (display "Unknown/Legacy").
- Never log passwords, tokens, MFA secrets, recovery codes, or private keys.
- Preserve existing 93 automated tests across all 4 suites.

## Review Focus
1. PM2 command/permission failure or malformed JSON output must reject deployment immediately.
2. `lsof` returning status 1 with non-empty stderr (permission denied, command not found, or diagnostics) must reject deployment.
3. Creator attribution must persist transactionally on account creation; legacy accounts without attribution must display "Unknown/Legacy".
4. Individual admin profile must clearly separate actions performed by the administrator from actions performed on their account.
5. All administrative mutations across actual modules (students, academic records, courses, batches, fees, notices, broadcasts, exports) must record structured audit events with allowlisted changes and zero secret leakage.

---

### Task 1: Refactor Maintenance Preflight Gate for Fail-Closed Subprocess Handling

**Files:**
- Modify: `scripts/preflight_lockdown_check.cjs`

- [ ] Support dependency injection for subprocess execution via `options.spawner` (defaulting to `child_process.spawnSync`).
- [ ] Replace `shell: true` with direct binary spawning (`shell: false`) using explicit argument arrays.
- [ ] In `checkWritersStopped`:
  - Run `spawner('pm2', ['jlist'], { encoding: 'utf8', timeout: 5000, shell: false })`.
  - If `pm2Result.error` (including `ENOENT`, `ETIMEDOUT`) or `pm2Result.status !== 0`: throw fatal error and abort.
  - Parse `pm2Result.stdout` with `JSON.parse`. If parse throws or parsed result is not an Array: throw fatal error and abort.
  - Inspect process list for `bfi-classroom` or `server.js`. If any instance has `status !== 'stopped'`, abort.
- [ ] In `checkDatabaseHandles`:
  - Reliably test tool availability:
    - Probe `lsof`: `spawner('lsof', ['-v'], { encoding: 'utf8', timeout: 5000, shell: false })`. Must have `status === 0` and no `error`. Matching stderr text is NOT acceptable.
    - Probe `fuser`: `spawner('fuser', ['-V'], { encoding: 'utf8', timeout: 5000, shell: false })`. Must have `status === 0` and no `error`.
  - When running `lsof <targets>`:
    - If `lsofRun.error`: throw fatal error and abort.
    - If `lsofRun.status === 0`: open handles found! Throw fatal error and abort.
    - If `lsofRun.status === 1`:
      - If `lsofRun.stderr && lsofRun.stderr.trim().length > 0`: permission denied or command failure! Throw fatal error and abort.
      - Only if `!lsofRun.stderr || lsofRun.stderr.trim() === ''`: PASS (0 active handles).
    - If `lsofRun.status > 1`: tool error &rarr; throw fatal error and abort.
  - When running `fuser <targets>`:
    - If `fuserRun.error` or `fuserRun.status === 0`: throw fatal error and abort.
    - If `fuserRun.status === 1`:
      - If `fuserRun.stderr && /permission denied|error|cannot/i.test(fuserRun.stderr)`: throw fatal error and abort.
      - Only if clean: PASS.
    - If `fuserRun.status > 1`: tool error &rarr; throw fatal error and abort.
  - If neither tool is installed or available: throw fatal error and abort.

---

### Task 2: Subprocess Dependency-Injection Rehearsal & Verification Suite

**Files:**
- Create: `scratch/rehearse_subprocess_fail_closed.cjs`
- Modify: `scratch/rehearse_fail_closed_gates.cjs`

- [ ] Implement controlled subprocess spawner fixtures simulating real system responses:
  1. PM2 command/permission error (`status: 1, stderr: 'EPERM: Operation not permitted'`).
  2. PM2 timeout (`error: { code: 'ETIMEDOUT' }`).
  3. PM2 malformed JSON (`status: 0, stdout: '{"invalid": json'`).
  4. PM2 non-array JSON (`status: 0, stdout: '{"app": "running"}'`).
  5. Missing `lsof` returning status 1 with `stderr: 'lsof: command not found'`.
  6. `lsof` returning status 1 with `stderr: 'lsof: WARNING: can\'t stat(): Permission denied'`.
  7. `lsof` returning status 0 with open handle stdout.
  8. Missing `fuser` returning status 127 or `ENOENT`.
  9. Valid clean stopped PM2 + clean `lsof` (status 1, empty stderr) &rarr; PASS.
- [ ] Run rehearsal and verify 100% of failure modes abort with exit code 1.

---

### Task 3: Database Schema Migration for Accountability & Creator Attribution

**Files:**
- Create: `server/db/migrations/20261025_admin_accountability.cjs`
- Modify: `server/db/database.js`

- [ ] Add `created_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL` to `users` table.
- [ ] Expand `admin_audit_logs` table with columns:
  - `module TEXT` (e.g. `'administrators'`, `'students'`, `'courses'`, `'batches'`, `'fees'`, `'notices'`, `'exports'`, `'auth'`)
  - `resource TEXT` (e.g. `'user:4'`, `'course_definition:2'`, `'batch:5'`, `'fee:12'`)
  - `outcome TEXT DEFAULT 'success'` (`'success'`, `'failed'`, `'denied'`)
  - `correlation_id TEXT`
  - `before_state TEXT`
  - `after_state TEXT`
- [ ] Create indexes for performant querying: `idx_audit_logs_module`, `idx_audit_logs_action`, `idx_audit_logs_outcome`, `idx_audit_logs_created_at`.
- [ ] Register migration in `app_migrations` and `database.js` for fresh test databases and production runner.

---

### Task 4: Operational Audit Ledger Service & OWASP Secret Redaction

**Files:**
- Create: `server/services/auditLedgerService.js`

- [ ] Implement `sanitizeAuditPayload(data)`: strictly redacts allowlist-prohibited fields (`password`, `token`, `secret`, `two_factor_secret`, `recoveryCodes`, `hash`, `private_key`, `authorization`).
- [ ] Implement `recordOperationalAudit(dbOrTx, { actorId, action, module, resource, targetUserId, outcome, details, beforeState, afterState, ipAddress, correlationId })`:
  - Generates ISO 8601 UTC timestamp.
  - Automatically captures correlation ID (from `req.correlationId` or `crypto.randomUUID()`).
  - Supports atomic inclusion in caller's `db.transaction`.
- [ ] Implement `recordDenialAudit(req, res, { module, resource, action, requiredPermission, reason })`:
  - Captures failed authorization attempts (HTTP 403) for security accountability.

---

### Task 5: Backend Administrator Accountability APIs

**Files:**
- Modify: `server/routes/admin-management.js`

- [ ] `GET /api/admin/administrators/accountability/summary`:
  - Server-derived totals: `totalAdministrators`, `activeAdministrators`, `inactiveAdministrators`.
  - Date-filtered count: `createdInRange` based on `startDate` and `endDate` query parameters.
  - Creator grouping: `creatorsSummary` grouped by `created_by_admin_id`, joining creator name and username; maps `NULL` to `{ creatorId: null, creatorName: 'Unknown/Legacy', creatorUsername: null, count: N }`.
- [ ] `GET /api/admin/administrators/:id/accountability-profile`:
  - Returns complete admin record with `created_by_admin_id` and creator object.
  - Effective permissions and permission mutation history from audit logs.
  - **Timeline 1 (Actions performed by this admin):** `actor_id = :id`.
  - **Timeline 2 (Changes made to this admin's account):** `target_user_id = :id` AND (`actor_id != :id` OR action in account lifecycle).
  - Security history: sessions, active MFA status, recovery events, auth failures.
- [ ] Update `POST /api/admin/administrators`:
  - Persist `created_by_admin_id = req.user.id` transactionally.
  - Record expanded operational audit log with `module: 'administrators'`, `resource: 'user:<id>'`, `outcome: 'success'`.
- [ ] Update `GET /api/admin/administrators/audit-logs`:
  - Support filters: `module`, `outcome`, `action`, `startDate`, `endDate`, `search`.
  - Return formatted records with before/after state, correlation ID, and Asia/Dhaka formatted timestamp string.
  - Guard strictly with `requireSuperAdmin`.

---

### Task 6: Operational Audit Logging Across Real Application Modules

**Files:**
- Modify: `server/routes/admin.js`
- Modify: `server/routes/course-definitions.js`
- Modify: `server/routes/batches.js`
- Modify: `server/routes/fees.js`
- Modify: `server/routes/broadcast.js`
- Modify: `server/routes/trash.js`
- Modify: `server/routes/student-export.js`
- Modify: `server/middleware/auth.js`

- [ ] Students & Academic records:
  - `POST /api/admin/students` &rarr; audit `student:create` (module: `students`).
  - `PUT /api/admin/students/:id` &rarr; audit `student:update` with allowlisted before/after.
  - `POST /api/admin/batches/results` &rarr; audit `academic_records:bulk_upload`.
- [ ] Course Definitions:
  - `POST /api/admin/course-definitions` &rarr; audit `course:create_draft`.
  - `PUT /api/admin/course-definitions/:id` &rarr; audit `course:edit_definition`.
  - `POST /api/admin/course-definitions/:id/publish` &rarr; audit `course:publish`.
- [ ] Batches:
  - `POST /api/admin/batches` &rarr; audit `batch:create`.
  - `PUT /api/admin/batches/:id` &rarr; audit `batch:update`.
- [ ] Fees & Payments:
  - Fee payments and discounts in `server/routes/fees.js` &rarr; audit `finance:record_payment`, `finance:apply_discount`.
- [ ] Notices & Broadcasts:
  - `POST /api/admin/announcements` &rarr; audit `notices:create`.
  - `POST /api/admin/broadcast` &rarr; audit `communications:send`.
- [ ] Sensitive Exports:
  - `GET /api/student-export/export` &rarr; audit `data_export:students`.
- [ ] Permission Denials:
  - In `server/middleware/auth.js`: when `requirePermission` or `requireSuperAdmin` returns 403, record a denial audit event.

---

### Task 7: Frontend UI Implementation (Accountability Dashboard, Profile, and Ledger)

**Files:**
- Modify: `src/pages/admin/AdminManagement.jsx`
- Modify: `src/pages/admin/AdminManagement.css`

- [ ] Add **Accountability Dashboard** Tab:
  - Metrics cards: Total Admins, Active Admins, Inactive Admins, Created in Selected Range.
  - Date range filter controls (`startDate`, `endDate`).
  - Creator breakdown cards/table with creator names and counts.
- [ ] Add **Individual Administrator Profile** Modal/View:
  - Identity card with status, creation date, last login, and creator name ("Unknown/Legacy" for legacy accounts).
  - Effective permissions badges and permission history timeline.
  - Distinct **Timeline 1: Actions Performed by Administrator**.
  - Distinct **Timeline 2: Changes Made to Account**.
  - Security history card (sessions, MFA events, authentication failures).
- [ ] Enhance **Operational Activity Ledger** Tab:
  - Filters: Module selector, Outcome selector (All, Success, Failed, Denied), Date range, Search.
  - Formatted Asia/Dhaka timestamps (`DD MMM YYYY, hh:mm A BST`).
  - Details modal showing before/after state diff, correlation ID, and target resource.
  - Zero hover movement standards (`<RULE[user_global]>`).

---

### Task 8: Automated Verification & Regression Test Suite

**Files:**
- Modify: `tests/super-admin.spec.js`

- [ ] Add tests 57-65 in `tests/super-admin.spec.js`:
  - Test 57: Maintenance gate rejects PM2 command errors, timeouts, and malformed JSON.
  - Test 58: Maintenance gate rejects missing `lsof` and permission-denied stderr on exit code 1.
  - Test 59: Accountability Dashboard returns server-derived counts, date range filters, and creator breakdown.
  - Test 60: Transactional creator attribution on admin creation (`created_by_admin_id`), with "Unknown/Legacy" for legacy admins.
  - Test 61: Administrator Profile renders dual timelines (actions by admin vs. actions on admin) and security history.
  - Test 62: Operational mutations across modules (students, courses, batches, fees, notices, exports) write structured audit events.
  - Test 63: Denied/failed administrative attempts produce distinguishable failure audit events.
  - Test 64: OWASP redaction: audit logs contain zero plaintext passwords, tokens, MFA secrets, or recovery codes.
  - Test 65: Access isolation: ordinary admin cannot view accountability dashboard, audit logs, or administrator profiles (HTTP 403).

---

### Task 9: Full Regression, Lint, and Build Verification

- [ ] Execute `npx playwright test tests/super-admin.spec.js` (all 65 tests pass).
- [ ] Execute regression suites (`course-definitions-api.spec.js`, `course-maker-e2e.spec.js`, `same-title-batch-collision.spec.js`) (37 tests pass).
- [ ] Run `npm run lint` &rarr; 0 errors.
- [ ] Run `npm run build` &rarr; exit code 0.
- [ ] Verify production database `server/bfi_classroom.db` integrity (913 enrollments, 1,786 users, 0 FK violations).

---

### Task 10: Update Implementation & Deployment Readiness Reports

**Files:**
- Modify: `docs/reports/super-admin-implementation-report.md`
- Modify: `docs/reports/super-admin-deployment-readiness.md`

- [ ] Document the fail-closed maintenance gate fixes and controlled fixture rehearsal.
- [ ] Document administrator accountability architecture, creator attribution, dual timelines, and operational ledger.
- [ ] Document OWASP Logging Cheat Sheet compliance and retention policy.
- [ ] Update exact revisions, working changes inventory, and readiness verdict.
