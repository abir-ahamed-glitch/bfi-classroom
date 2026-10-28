# Admin Archiving & Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement non-destructive Admin Archiving, multi-cycle accountability history, and Super Admin-initiated password reset with persistent access blocking, email ownership binding, and URL fragment security for BFI Classroom.

**Architecture:** Database schema extensions add archive tracking, email verification challenges, persistent reset-pending state, and mandatory monotonic `account_version` concurrency guards. Access interceptors enforce strict blocking across APIs, login, refresh, MFA, and WebSockets. Password reset uses opaque 256-bit single-use tokens pinned to account credential versions, transported via URL fragments to keep secrets out of web server and proxy access logs.

**Tech Stack:** Node.js, Express, better-sqlite3, Socket.io, React, Tailwind CSS, Lucide Icons, Nodemailer, Vitest / Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-28-admin-archiving-and-accountability-design.md`

## Global Constraints

- Never delete, cascade-delete, truncate, or alter student, teacher, course, batch, payment, assignment, or audit records when archiving an administrator.
- Protected Account Rule: Super Admin (ID 1) can never be archived, deactivated, or peer-reset; attempt returns HTTP 403.
- Database Safety: Run all tests against disposable, isolated SQLite databases (`tests/test-db-isolation.js`); never execute destructive tests against `server/bfi_classroom.db`.
- Sudo Verification: Archiving, restoring, reset initiation, and history export strictly require recent Super Admin password verification via `requireRecentAuth`.
- Mandatory Concurrency: Every mutation endpoint mandates `expected_account_version` and updates `account_version = account_version + 1` atomically.
- Token Confidentiality: Raw reset tokens must never appear in application logs, PM2 output, analytics, or URL paths; direct link responses must set `Cache-Control: no-store`.
- No Auto-Dispatch to Unverified Emails: If `email_verified_at IS NULL` or `email !== verified_email`, email reset is rejected with HTTP 400.
- Manual Delivery Isolation: Direct out-of-band link generation is an explicitly selected Super Admin option requiring independent identity confirmation; it is never an automatic fallback.
- Credential Security: Remove hard-coded fallback SMTP credentials in `server/utils/email.js`; do not expose or print credentials; require protected environment configuration.

## Review Focus

1. Freshly issued reset link failure: Ensure target's `token_version` is bumped first within the transaction and the token is bound to the *resulting* version so consumption matches.
2. Token leakage in reverse proxy logs: Ensure reset links use client-side URL fragments (`#token=...`) and are stripped immediately from browser history.
3. Concurrency conflict on state cycling: Ensure stale requests after an archive → restore cycle are rejected via mandatory `account_version` checks.
4. Activation of archived account: Ensure every status/activation endpoint rejects archived administrators with HTTP 400 `ACCOUNT_ARCHIVED`.
5. CSV formula injection evasion: Ensure fields with leading whitespace/tabs/quotes and characters `=,+,-,@,\t,\r` are neutralized with single quotes.

---

## File Structure

```
server/
├── db/
│   └── migrations/
│       └── 20261028_admin_archiving_and_reset.cjs   # Schema migration & table recreation
├── middleware/
│   └── auth.js                                     # authenticateToken blocking & CSV sanitization
├── routes/
│   ├── auth.js                                     # Login, refresh, MFA, email verification routes
│   └── admin-management.js                         # Archive, restore, reset initiation & export routes
├── utils/
│   └── email.js                                    # Hardened email transport (env only, 30m copy)
src/
├── pages/
│   └── admin/
│       ├── AdminManagement.jsx                     # UI tabs, modals, and accountability timelines
│       └── AdminManagement.css                     # Accessible styles & badges
│   └── AdminPasswordReset.jsx                      # Fragment-reading secure reset page
tests/
├── admin-archiving-and-reset.spec.js                # Comprehensive automated backend test suite
└── test-db-isolation.js                            # In-memory / isolated SQLite test fixture
```

---

## Task 1: Database Migration & Schema Upgrade

**Files:**
- Create: `server/db/migrations/20261028_admin_archiving_and_reset.cjs`
- Modify: `server/db/database.js`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write failing test for database migration**
  Write tests in `tests/admin-archiving-and-reset.spec.js` verifying that:
  - `users` table gains `archived_at`, `archived_by_admin_id`, `archive_reason`, `restored_at`, `restored_by_admin_id`, `restore_reason`, `email_verified_at`, `verified_email`, `password_reset_pending`, `password_reset_requested_at`, `password_reset_requested_by`, `account_version`.
  - `email_verification_challenges` table is created.
  - Legacy `password_reset_tokens` table is transactionally upgraded to include `purpose`, `token_version`, and `created_by_admin_id`.
  - Running the migration twice is idempotent.

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`
  Verify test fails with missing columns or unmigrated tables.

- [ ] **Step 3: Implement `20261028_admin_archiving_and_reset.cjs`**
  Implement the transactional migration:
  - Add missing columns to `users` via `ALTER TABLE`.
  - Create `email_verification_challenges` table.
  - Upgrade `password_reset_tokens` using the SQLite table rename-and-recreate pattern (`PRAGMA foreign_keys = OFF; BEGIN TRANSACTION; ALTER TABLE ... RENAME TO _old; CREATE TABLE ...; DROP TABLE _old; COMMIT; PRAGMA foreign_keys = ON;`).
  - Track migration name in `app_migrations`.

- [ ] **Step 4: Register migration in `server/db/database.js`**
  Require and call `runAdminArchivingAndResetMigration(db)` in `initializeDatabase()`.

- [ ] **Step 5: Run migration test and verify passing**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`
  Verify all migration assertions pass.

- [ ] **Step 6: Commit Task 1**
  `git commit -m "feat(db): add admin archiving, email verification, and password reset migration"`

---

## Task 2: Secure Email Configuration & Credential Hardening

**Files:**
- Modify: `server/utils/email.js`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write test for email utility hardening**
  Test that `getTransporter()` returns null when `EMAIL_USER` or `EMAIL_PASS` is undefined, and that `sendPasswordResetEmail` accurately formats the 30-minute expiration and admin-initiated subject.

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 3: Remove hard-coded credentials in `server/utils/email.js`**
  - Delete hard-coded username and app password fallback strings.
  - Read strictly from `process.env.EMAIL_USER` and `process.env.EMAIL_PASS`.
  - Update email template to state: "An administrator password reset has been initiated for your BFI Classroom account by Super Admin. This single-use link will expire in 30 minutes."
  - Add `sendPasswordChangeNotificationEmail(toEmail, { dhakaTime, ipAddress })` without secrets.

- [ ] **Step 4: Run test and verify passing**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 5: Commit Task 2**
  `git commit -m "fix(security): remove hardcoded email fallback credentials and update 30m reset template"`

---

## Task 3: Access Blocking & Session Enforcement Interceptors

**Files:**
- Modify: `server/middleware/auth.js`
- Modify: `server/routes/auth.js`
- Modify: `server/server.js`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write tests for access blocking**
  Write tests asserting that an account with `password_reset_pending === 1` or `archived_at !== null`:
  - Receives HTTP 403 on API requests with access token (`PASSWORD_RESET_PENDING`).
  - Receives HTTP 403 on `/api/auth/login`.
  - Receives HTTP 403 on `/api/auth/mfa-verify`.
  - Receives HTTP 403 on `/api/auth/refresh` and cookie is cleared.
  - Sockets are disconnected and handshakes rejected.

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 3: Update `authenticateToken` in `server/middleware/auth.js`**
  Check `user.archived_at !== null` (return 401) and `user.password_reset_pending === 1` (return 403 `PASSWORD_RESET_PENDING`).

- [ ] **Step 4: Update `/login`, `/mfa-verify`, and `/refresh` in `server/routes/auth.js`**
  Reject archived accounts and accounts with `password_reset_pending === 1`. Clear refresh cookies on rejection.

- [ ] **Step 5: Update Socket authentication in `server/server.js`**
  Reject socket connection if `user.archived_at !== null` or `user.password_reset_pending === 1`.

- [ ] **Step 6: Run tests and verify passing**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 7: Commit Task 3**
  `git commit -m "feat(auth): enforce persistent reset-pending and archived account blocking across all protocols"`

---

## Task 4: Mandatory Concurrency & Admin Archiving / Restoration Endpoints

**Files:**
- Modify: `server/routes/admin-management.js`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write tests for archive, restore, and concurrency protection**
  Write tests asserting:
  - Super Admin (ID 1) cannot be archived or deactivated (HTTP 403).
  - Missing `expected_account_version` returns HTTP 400.
  - Stale `expected_account_version` returns HTTP 409 `CONCURRENCY_CONFLICT`.
  - Archive operation sets `is_active = 0`, `archived_at`, deletes sessions, bumps `token_version` and `account_version`, invalidates reset tokens, and writes audit log.
  - Restore operation sets `archived_at = NULL`, `is_active = 0` (INACTIVE), and logs audit.
  - Activating an archived admin via `/status` returns HTTP 400 `ACCOUNT_ARCHIVED`.
  - Audit log failure triggers transaction rollback.

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 3: Implement `POST /api/admin/administrators/:id/archive`**
  Add endpoint with `requireSuperAdmin`, `requireRecentAuth`, mandatory `expected_account_version`, atomic transaction, session revocation, socket disconnect, and audit write.

- [ ] **Step 4: Implement `POST /api/admin/administrators/:id/restore`**
  Add endpoint with `requireSuperAdmin`, `requireRecentAuth`, mandatory `expected_account_version`, restoring strictly as `is_active = 0`, and audit write.

- [ ] **Step 5: Update `PATCH /api/admin/administrators/:id/status`**
  Enforce mandatory `expected_account_version` and reject if `archived_at !== null` with `ACCOUNT_ARCHIVED`.

- [ ] **Step 6: Update `GET /api/admin/administrators` & accountability summary**
  Separate current admins (`archived_at IS NULL`) from archived admins (`archived_at IS NOT NULL`). Provide accurate non-overlapping KPI counts.

- [ ] **Step 7: Run tests and verify passing**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 8: Commit Task 4**
  `git commit -m "feat(admin): implement transactional admin archiving, restoration, and concurrency control"`

---

## Task 5: Email Ownership Verification & Global Password Reset Invalidation

**Files:**
- Modify: `server/routes/auth.js`
- Modify: `server/routes/admin-management.js`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write tests for email verification challenges and address binding**
  Write tests asserting:
  - New/existing accounts start with `email_verified_at = NULL`.
  - `POST /api/auth/verify-email/request` creates opaque challenge in `email_verification_challenges`.
  - `POST /api/auth/verify-email/confirm` sets `email_verified_at` and `verified_email`.
  - Changing email address clears `email_verified_at` and `verified_email`, and deletes outstanding reset tokens.
  - Any password change (profile or reset) invalidates outstanding reset tokens and bumps `token_version`.

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 3: Implement email verification endpoints in `server/routes/auth.js`**
  Implement `/verify-email/request` and `/verify-email/confirm` binding exact address and account.

- [ ] **Step 4: Implement email change invalidation trigger**
  In any route updating `users.email`, clear `email_verified_at = NULL, verified_email = NULL` and delete reset tokens.

- [ ] **Step 5: Enforce global reset invalidation on all password changes**
  In all password modification routes, ensure `DELETE FROM password_reset_tokens WHERE user_id = ?` and `token_version = token_version + 1`.

- [ ] **Step 6: Run tests and verify passing**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 7: Commit Task 5**
  `git commit -m "feat(auth): bind email verification challenges and enforce global reset link invalidation"`

---

## Task 6: Super Admin-Initiated Reset Endpoints & URL Fragment Architecture

**Files:**
- Create: `src/pages/AdminPasswordReset.jsx`
- Modify: `server/routes/admin-management.js`
- Modify: `server/routes/auth.js`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write tests for reset initiation, token consumption, and version binding**
  Write tests asserting:
  - Reset initiation bumps target's `token_version` to V+1 and binds token to V+1.
  - Freshly issued link successfully sets new password (`token_version` matches).
  - Reset link uses URL fragment `#userId=...&token=...`.
  - Email dispatch to unverified email returns HTTP 400 `EMAIL_NOT_VERIFIED`.
  - Direct out-of-band link generation succeeds with `Cache-Control: no-store` and does not leak token in logs.
  - `/api/admin/reset-password/complete` consumes token atomically and updates password hash.
  - Target account status (`is_active`) is preserved unchanged after password reset.

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 3: Implement `POST /api/admin/administrators/:id/reset-password/email`**
  Super Admin only, `requireRecentAuth`, verifies email ownership, atomic order (user first -> token with V+1), dispatches fragment link via SMTP, audits `admin.mail_submitted` or `admin.mail_submission_failed`.

- [ ] **Step 4: Implement `POST /api/admin/administrators/:id/reset-password/direct-link`**
  Super Admin only, `requireRecentAuth`, explicit manual delivery mode, returns fragment URL with `no-store` headers, audits `admin.direct_reset_link_generated`.

- [ ] **Step 5: Implement `POST /api/admin/reset-password/complete`**
  Validates token hash, checks `token.token_version === user.token_version`, verifies password policy, updates password, clears `password_reset_pending = 0`, sends async security alert without secrets.

- [ ] **Step 6: Create `src/pages/AdminPasswordReset.jsx`**
  Client component:
  - Reads `#userId=...&token=...` from `window.location.hash`.
  - Immediately scrubs hash via `window.history.replaceState(null, '', window.location.pathname)`.
  - Submits token and new password in POST body.
  - Contains zero third-party fonts, external CDNs, or tracking scripts.

- [ ] **Step 7: Run tests and verify passing**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 8: Commit Task 6**
  `git commit -m "feat(admin): implement super admin password reset with url fragment transport and version binding"`

---

## Task 7: Multi-Cycle Accountability Timeline & Audited Export with Formula Injection Defense

**Files:**
- Modify: `server/routes/admin-management.js`
- Modify: `server/middleware/auth.js`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write tests for multi-cycle history and CSV formula injection defense**
  Write tests asserting:
  - `GET /api/admin/administrators/:id/accountability-profile` includes `archiveRestoreLifecycle` timeline containing every past cycle.
  - `GET /api/admin/administrators/:id/export-history` exports CSV/JSON with 5,000 record cap.
  - Values `=cmd`, `  +SUM`, `\t@danger`, `" -1+2"` are neutralized with single quotes.
  - Export is recorded in `admin_audit_logs`.

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 3: Implement `sanitizeCsvField` in `server/middleware/auth.js`**
  Implement regex neutralizing `=,+,-,@,\t,\r` preceded by whitespace or quotes.

- [ ] **Step 4: Update accountability profile in `server/routes/admin-management.js`**
  Query `admin_audit_logs` for `action IN ('archive_administrator', 'restore_administrator')` and return structured lifecycle cycles.

- [ ] **Step 5: Implement `GET /api/admin/administrators/:id/export-history`**
  Super Admin only, `requireRecentAuth`, filters by module/outcome/date, limits to 5,000 rows, scrubs secrets via `redactSensitiveData()`, applies `sanitizeCsvField`, and writes audit log.

- [ ] **Step 6: Run tests and verify passing**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 7: Commit Task 7**
  `git commit -m "feat(admin): add multi-cycle archive timeline and hardened csv export with dde defense"`

---

## Task 8: Admin Management UI Enhancements

**Files:**
- Modify: `src/pages/admin/AdminManagement.jsx`
- Modify: `src/pages/admin/AdminManagement.css`
- Test: Frontend build & component rendering

- [ ] **Step 1: Preserve existing tabs and add Current vs Archived sub-views**
  Under top-level `administrators` tab, add toggle pills for `Current Administrators` and `Archived Administrators`. Preserve `defaults`, `audit`, and `security` tabs intact.

- [ ] **Step 2: Implement Archived Admins table & actions**
  Table showing name, username, email, archived date (Dhaka time), archived by, and reason, with "View Profile", "Export History", and "Restore Admin" buttons.

- [ ] **Step 3: Update KPI cards with accurate non-overlapping counts**
  Render Total Current Admins, Active Admins, Inactive Admins, and Archived Admins (with explanatory note).

- [ ] **Step 4: Implement modals without exposing `account_version`**
  - Archive Modal: Reason input, clear warning, sudo password. `expected_account_version` passed silently in payload.
  - Restore Modal: Reason input, warning of inactive restoration, sudo password.
  - Reset Password Modal: Display target details and verified email status. Provide "Send to Verified Email" or explicit "Generate Out-of-Band Link" option.
  - Secure Link Modal: Displays one-time link with copy button and 30-minute timer.

- [ ] **Step 5: Verify build passes cleanly**
  Run: `npm run build`

- [ ] **Step 6: Commit Task 8**
  `git commit -m "feat(ui): add archived admins view, reset modals, and non-overlapping kpi counts"`

---

## Task 9: End-to-End Automated Test Suite & Regression Verification

**Files:**
- Modify: `tests/admin-archiving-and-reset.spec.js`
- Test: Complete test suite

- [ ] **Step 1: Execute full test suite against isolated database**
  Run: `npm test` or `node --test tests/admin-archiving-and-reset.spec.js`
  Verify all test scenarios pass with exit code 0.

- [ ] **Step 2: Verify production build & lint**
  Run: `npm run build`
  Verify 0 errors, 0 warnings.

- [ ] **Step 3: Commit Task 9**
  `git commit -m "test(admin): verify full admin archiving and password reset test suite"`
