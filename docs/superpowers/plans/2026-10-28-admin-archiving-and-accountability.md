# Admin Archiving & Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement non-destructive Admin Archiving, multi-cycle accountability history, and Super Admin-initiated password reset with persistent access blocking, email ownership binding, URL fragment security, and full preservation of existing user/admin password recovery flows for BFI Classroom.

**Architecture:** Database schema extensions add archive tracking, email verification challenges, persistent reset-pending state, and mandatory monotonic `account_version` concurrency guards. Access interceptors enforce strict blocking across APIs, login, refresh, MFA, and WebSockets. Password reset uses opaque 256-bit single-use tokens pinned to account credential versions, transported via URL fragments to keep secrets out of web server and proxy access logs. Existing student and admin recovery flows are explicitly preserved via distinct purpose binding (`user_recovery`, `admin_self_recovery`, `admin_password_reset`).

**Tech Stack:** Node.js, Express, better-sqlite3, Socket.io, React, React Router, Tailwind CSS, Lucide Icons, Nodemailer, Node test runner (`node --test`), Playwright.

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
- Real Test Execution: Run tests with `node --test` and `npx playwright test` (package.json has no `npm test` script). Run `npm run lint` separately from `npm run build` and report existing lint warnings honestly.

## Review Focus

1. Freshly issued reset link failure: Ensure target's `token_version` is bumped first within the transaction and the token is bound to the *resulting* version so consumption matches.
2. Token leakage in reverse proxy logs: Ensure reset links use client-side URL fragments (`#token=...`) and are stripped immediately from browser history.
3. Concurrency conflict on state cycling: Ensure stale requests after an archive → restore cycle are rejected via mandatory `account_version` checks.
4. Activation of archived account: Ensure every status/activation endpoint rejects archived administrators with HTTP 400 `ACCOUNT_ARCHIVED`.
5. CSV formula injection evasion: Ensure fields with leading whitespace/tabs/quotes and characters `=,+,-,@,\t,\r` are neutralized with single quotes.
6. Existing recovery breakage: Ensure student recovery (`user_recovery`) and admin self-recovery (`admin_self_recovery`) flows function without error alongside Super Admin reset (`admin_password_reset`).

---

## File Structure

```
server/
├── db/
│   ├── database.js                                  # Migration registration & connection setup
│   └── migrations/
│       └── 20261028_admin_archiving_and_reset.cjs   # Canonical transactional schema migration
├── middleware/
│   └── auth.js                                     # authenticateToken blocking & CSV sanitization
├── routes/
│   ├── auth.js                                     # Login, refresh, MFA, email verification, existing recovery routes
│   └── admin-management.js                         # Archive, restore, reset initiation & export routes
├── utils/
│   └── email.js                                    # Hardened email transport (env only, distinct templates)
scripts/
└── run_migrations.cjs                              # Canonical migration runner and integrity check
src/
├── App.jsx                                         # Router mounting for /admin/reset-password
├── pages/
│   ├── AdminResetPassword.jsx                      # Fragment-reading secure reset page (hash scrubbing)
│   └── admin/
│       ├── AdminManagement.jsx                     # UI tabs, modals, and accountability timelines
│       └── AdminManagement.css                     # Accessible styles & badges
tests/
├── admin-archiving-and-reset.spec.js                # Comprehensive automated backend test suite
└── test-db-isolation.js                            # In-memory / isolated SQLite test fixture
```

---

## Task 1: Database Migration & Schema Upgrade

**Files:**
- Create: `server/db/migrations/20261028_admin_archiving_and_reset.cjs`
- Modify: `server/db/database.js`
- Modify: `scripts/run_migrations.cjs`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write failing test for database migration & schema upgrade**
  Write tests in `tests/admin-archiving-and-reset.spec.js` verifying that:
  - Source-code inspection baseline: Verify the isolated database schema against the source code baseline (`server/db/database.js:452-459`).
  - `users` table gains `archived_at`, `archived_by_admin_id`, `archive_reason`, `restored_at`, `restored_by_admin_id`, `restore_reason`, `email_verified_at`, `verified_email`, `password_reset_pending`, `password_reset_requested_at`, `password_reset_requested_by`, `account_version`.
  - `email_verification_challenges` table is created.
  - Legacy `password_reset_tokens` table is transactionally upgraded to include `purpose`, `token_version`, and `created_by_admin_id`, with `UNIQUE(user_id, purpose)`.
  - Legacy reset links are safely discarded during table recreation.
  - Running the migration twice is idempotent.
  - Foreign key check (`PRAGMA foreign_key_check`) returns 0 errors.

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`
  Verify test fails with missing columns or unmigrated tables.

- [ ] **Step 3: Implement `server/db/migrations/20261028_admin_archiving_and_reset.cjs`**
  Implement the transactional migration:
  - Safe foreign-key toggle pattern with `try ... finally` restoring settings.
  - Add missing columns to `users` via `ALTER TABLE`.
  - Create `email_verification_challenges` table.
  - Upgrade `password_reset_tokens` using the SQLite table rename-and-recreate pattern (`PRAGMA foreign_keys = OFF; BEGIN TRANSACTION; ALTER TABLE ... RENAME TO _password_reset_tokens_old; CREATE TABLE password_reset_tokens ...; DROP TABLE _password_reset_tokens_old; COMMIT;`).
  - Track migration name in `app_migrations`.

- [ ] **Step 4: Register migration in canonical runner `scripts/run_migrations.cjs` & `server/db/database.js`**
  - Add `{ name: '20261028_admin_archiving_and_reset', runner: runAdminArchivingAndResetMigration }` to `MIGRATIONS` in `scripts/run_migrations.cjs`.
  - Update `assertSchemaIntegrity(db)` in `scripts/run_migrations.cjs` to assert the 12 new columns and tables.
  - Call `runAdminArchivingAndResetMigration(db)` in `server/db/database.js`.

- [ ] **Step 5: Run migration test and canonical runner**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`
  Run: `node scripts/run_migrations.cjs` on isolated test DB.
  Verify all migration assertions pass.

- [ ] **Step 6: Commit Task 1**
  `git commit -m "feat(db): implement transactional migration for admin archiving, verification, and reset tokens"`

---

## Task 2: Secure Email Utility Hardening & Multi-Flow Template Support

**Files:**
- Modify: `server/utils/email.js`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write tests for email utility hardening & template separation**
  Write tests in `tests/admin-archiving-and-reset.spec.js` asserting:
  - `getTransporter()` returns null when `EMAIL_USER` or `EMAIL_PASS` is missing.
  - Hard-coded credential fallback is absent.
  - Flow 1 / 2: User and Admin self-recovery template uses 15-minute expiration and self-service copy.
  - Flow 3: Super Admin-initiated reset template uses 30-minute expiration and Super Admin-initiated copy.
  - Password change notification email formats correctly without exposing secrets.

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 3: Refactor `server/utils/email.js`**
  - Completely remove hard-coded username and app password fallback strings.
  - Require `process.env.EMAIL_USER` and `process.env.EMAIL_PASS`.
  - Implement `sendPasswordResetEmail(toEmail, resetLink, { isSuperAdminInitiated = false } = {})`.
  - Implement `sendPasswordChangeNotificationEmail(toEmail, { dhakaTime, ipAddress })`.
  - Implement `sendEmailVerificationChallenge(toEmail, verificationLink)`.

- [ ] **Step 4: Run tests and verify passing**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 5: Commit Task 2**
  `git commit -m "fix(security): remove hardcoded email fallback and support multi-flow reset templates"`

---

## Task 3: Access Blocking Interceptors & Distinct Error Responses

**Files:**
- Modify: `server/middleware/auth.js`
- Modify: `server/routes/auth.js`
- Modify: `server/server.js`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write tests for distinct access blocking responses**
  Write tests verifying the exact, distinct responses defined in the spec:
  - **Archived admin:**
    - `authenticateToken`: HTTP 401 `{ error: 'Account inactive, archived, or not found' }`
    - `/api/auth/login`: HTTP 401 `{ error: 'Invalid credentials' }`
    - `/api/auth/refresh`: HTTP 401 `{ error: 'User not found' }` (clears cookie)
    - `/api/auth/mfa-verify`: HTTP 401 `{ error: 'MFA challenge expired or invalidated. Account inactive or revoked.' }`
    - Socket handshake: Rejects with `'Account inactive or revoked'`
  - **Password reset pending admin (`password_reset_pending === 1`):**
    - `authenticateToken`: HTTP 403 `{ error: 'Password reset pending for this account. You must set a new password before accessing the system.', code: 'PASSWORD_RESET_PENDING' }`
    - `/api/auth/login`: HTTP 403 `{ error: 'A password reset has been initiated for this account. You must set a new password using your reset link before logging in.', code: 'PASSWORD_RESET_PENDING' }`
    - `/api/auth/refresh`: HTTP 403 `{ error: 'Password reset pending for this account.', code: 'PASSWORD_RESET_PENDING' }` (clears cookie)
    - `/api/auth/mfa-verify`: HTTP 403 `{ error: 'Password reset pending for this account.', code: 'PASSWORD_RESET_PENDING' }`
    - Socket handshake: Rejects with `'Account password reset pending'`
  - **Inactive admin:**
    - HTTP 401 across endpoints, allows activation via `/status`.

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 3: Update `authenticateToken` in `server/middleware/auth.js`**
  Add explicit checks for `user.archived_at !== null` (401) and `user.password_reset_pending === 1` (403 `PASSWORD_RESET_PENDING`).

- [ ] **Step 4: Update `/login`, `/mfa-verify`, and `/refresh` in `server/routes/auth.js`**
  Implement distinct responses: reject archived accounts with 401, reject reset-pending accounts with 403. Clear cookies on refresh rejection.

- [ ] **Step 5: Update Socket.io middleware in `server/server.js`**
  Reject connection with specific error strings for archived vs reset-pending states.

- [ ] **Step 6: Run tests and verify passing**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 7: Commit Task 3**
  `git commit -m "feat(auth): enforce distinct access blocking for archived vs reset-pending accounts"`

---

## Task 4: Mandatory Concurrency Control & Admin Archiving / Restoration Endpoints

**Files:**
- Modify: `server/routes/admin-management.js`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write tests for archive, restore, and concurrency protection**
  Write tests asserting:
  - Super Admin (ID 1) cannot be archived, deactivated, or peer-reset (HTTP 403).
  - Missing `expected_account_version` returns HTTP 400 `MISSING_ACCOUNT_VERSION`.
  - Stale `expected_account_version` returns HTTP 409 `CONCURRENCY_CONFLICT`.
  - Archive operation sets `is_active = 0`, `archived_at`, deletes sessions, bumps `token_version` and `account_version`, clears `password_reset_pending = 0`, invalidates reset tokens, and writes audit log.
  - Restore operation sets `archived_at = NULL`, `is_active = 0` (INACTIVE), and logs audit.
  - Activating an archived admin via `/status` returns HTTP 400 `ACCOUNT_ARCHIVED`.
  - Cycle test: Admin archived -> restored -> stale archive request with old version is rejected.
  - Audit log failure triggers transaction rollback across archive and restore.

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

## Task 5: Preservation of Existing Recovery Flows & Email Ownership Binding

**Files:**
- Modify: `server/routes/auth.js`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write tests for all three password recovery flows & email binding**
  Write tests in `tests/admin-archiving-and-reset.spec.js` verifying:
  - **Flow 1 (Student Recovery):**
    - `POST /api/auth/forgot-password` generates token with `purpose = 'user_recovery'`, 15m expiry.
    - `POST /api/auth/reset-password/:id/:token` consumes token with `purpose = 'user_recovery'`.
    - Cannot consume a token generated for another purpose.
  - **Flow 2 (Admin Self-Recovery):**
    - `POST /api/auth/admin-forgot-password` generates token with `purpose = 'admin_self_recovery'`, 15m expiry.
    - `POST /api/auth/admin-reset-password/:id/:token` consumes token with `purpose = 'admin_self_recovery'`.
  - **Email Ownership Binding:**
    - New/existing accounts start with `email_verified_at = NULL`.
    - `POST /api/auth/verify-email/request` generates challenge in `email_verification_challenges`.
    - `POST /api/auth/verify-email/confirm` sets `email_verified_at` and `verified_email`.
    - Modifying email address clears verification and deletes pending reset tokens.
  - **Global Reset Invalidation:**
    - Any password change (profile or recovery) invalidates outstanding reset tokens and bumps `token_version`.

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 3: Update Flow 1 & Flow 2 in `server/routes/auth.js`**
  - Update `POST /forgot-password` and `POST /reset-password/:id/:token` to use `purpose: 'user_recovery'` and `token_version: user.token_version || 1`.
  - Update `POST /admin-forgot-password` and `POST /admin-reset-password/:id/:token` to use `purpose: 'admin_self_recovery'` and `token_version: user.token_version || 1`.

- [ ] **Step 4: Implement email verification endpoints in `server/routes/auth.js`**
  Implement `/verify-email/request` and `/verify-email/confirm` binding exact address and account.

- [ ] **Step 5: Enforce global reset link invalidation**
  In all password and email update handlers, execute `DELETE FROM password_reset_tokens WHERE user_id = ?`.

- [ ] **Step 6: Run tests and verify passing**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 7: Commit Task 5**
  `git commit -m "feat(auth): preserve existing recovery flows and bind email ownership challenges"`

---

## Task 6: Super Admin-Initiated Reset Endpoints & URL Fragment Architecture

**Files:**
- Modify: `server/routes/admin-management.js`
- Modify: `server/routes/auth.js`
- Modify: `src/App.jsx`
- Modify: `src/pages/AdminResetPassword.jsx`
- Test: `tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 1: Write tests for Super Admin-initiated reset & version binding**
  Write tests in `tests/admin-archiving-and-reset.spec.js` asserting:
  - Reset initiation updates target user first (`token_version = token_version + 1`), then binds token to resulting version ($V+1$).
  - Freshly issued link successfully sets new password (`token_version` matches).
  - Email dispatch on unverified email returns HTTP 400 `EMAIL_NOT_VERIFIED`.
  - Direct out-of-band link generation returns fragment URL with `Cache-Control: no-store` and audits `admin.direct_reset_link_generated`.
  - `/api/admin/reset-password/complete` consumes token atomically and updates password hash.
  - Inactive account remains inactive after password reset.
  - Target account with `archived_at !== null` cannot reset password (HTTP 400 `ACCOUNT_ARCHIVED`).

- [ ] **Step 2: Run test to confirm failure**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 3: Implement `POST /api/admin/administrators/:id/reset-password/email`**
  Super Admin only, `requireRecentAuth`, verifies email ownership, atomic order (user first -> token with V+1), dispatches fragment link via SMTP, audits `admin.mail_submitted` or `admin.mail_submission_failed`.

- [ ] **Step 4: Implement `POST /api/admin/administrators/:id/reset-password/direct-link`**
  Super Admin only, `requireRecentAuth`, explicit manual delivery mode, returns fragment URL with `no-store` headers, audits `admin.direct_reset_link_generated`.

- [ ] **Step 5: Implement `POST /api/admin/reset-password/complete`**
  Validates token hash, checks `token.token_version === user.token_version`, verifies password policy, updates password, clears `password_reset_pending = 0`, sends async security alert without secrets.

- [ ] **Step 6: Update router mounting in `src/App.jsx`**
  Mount `<Route path="/admin/reset-password" element={<AdminResetPassword />} />` directly (respecting `routerBase`).

- [ ] **Step 7: Update `src/pages/AdminResetPassword.jsx`**
  - Read `#userId=...&token=...` from `window.location.hash`.
  - Immediately scrub hash via `window.history.replaceState(null, '', window.location.pathname)`.
  - Submit token and new password to `/api/admin/reset-password/complete` in POST body.
  - Enforce full password policy regex.

- [ ] **Step 8: Run tests and verify passing**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`

- [ ] **Step 9: Commit Task 6**
  `git commit -m "feat(admin): implement super admin reset with url fragment transport and version binding"`

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
- Test: Frontend build & Playwright browser test

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

- [ ] **Step 5: Commit Task 8**
  `git commit -m "feat(ui): add archived admins view, reset modals, and non-overlapping kpi counts"`

---

## Task 9: Browser Interaction Testing, Verification & Regression Suite

**Files:**
- Modify: `tests/super-admin.spec.js`
- Test: Playwright suite, existing scripts, build, and lint

- [ ] **Step 1: Add Playwright browser interaction test scenarios**
  In `tests/super-admin.spec.js`:
  - Test Current vs Archived sub-view switching.
  - Test Archive Admin flow (cancel, confirm with sudo password, verify account moves to Archived tab).
  - Test Restore Admin flow (confirm with sudo password, verify account moves back to Current as Inactive).
  - Test Reset Password modal (email verification status check, out-of-band link copy with timer).
  - Test Direct Reset URL flow in browser: open fragment URL, verify hash stripped from history, set new password, verify redirect to login.
  - Test CSV export trigger.
  - Test Responsive Viewports (Desktop 1280x800, Mobile 375x667) and Light/Dark themes.
  - Save screenshots to artifact directory (`C:\Users\shahi\.gemini\antigravity\brain\8a2c550d-de2b-4cee-a467-088c18dbcc23`).

- [ ] **Step 2: Execute backend test suite**
  Run: `node --test tests/admin-archiving-and-reset.spec.js`
  Verify 100% passing.

- [ ] **Step 3: Execute existing regression scripts**
  Run: `node scripts/test_credential_handoff.cjs`
  Run: `node scripts/test_verify_isolation.cjs`
  Verify all assertions pass.

- [ ] **Step 4: Execute Playwright browser suite**
  Run: `npx playwright test tests/super-admin.spec.js`
  Verify browser tests pass and screenshots are captured.

- [ ] **Step 5: Run linter and report warnings honestly**
  Run: `npm run lint`
  Document any existing project lint warnings truthfully.

- [ ] **Step 6: Run production build**
  Run: `npm run build`
  Verify build succeeds with exit code 0.

- [ ] **Step 7: Commit Task 9**
  `git commit -m "test(admin): verify full browser interactions, regression scripts, and production build"`
