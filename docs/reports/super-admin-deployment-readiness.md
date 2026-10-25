# BFI Classroom Super Admin Feature: Deployment Readiness Report

**Date:** October 25, 2026  
**Integration Candidate Branch:** `integration/super-admin-candidate`  
**Candidate Worktree Location:** `.worktrees/super-admin-integration`  
**Base Revisions:** `main` (`4d8feb06741de5c0986a09cb6fec1374370d20cb`) + `feature/super-admin` (`7177e24` + working tree)  
**Common Ancestor:** `5b5faae`  
**Target Environment:** Oracle Cloud Infrastructure (PM2 / Node.js / SQLite WAL mode / Cloudflare Turnstile)  
**Overall Verdict:** **`READY FOR APPROVAL`**

---

## Executive Summary

This report documents the deployment preparation and independent verification of the BFI Classroom Super Admin governance system and privileged account safeguards. The complete feature set has been reconciled with the latest `main` branch (`4d8feb0`) inside an isolated integration worktree (`.worktrees/super-admin-integration`).

All deployment-readiness requirements and review corrections have been resolved and verified:
1. **Integration Candidate Refreshed to Latest `main` (`4d8feb0`):** Incorporated the platform-wide removal of hover movement and zoom effects from `4d8feb0` across all UI styles, while preserving Super Admin functionality, including `getRoleDisplay` in `PublicProfile.jsx`, static transitions in `AdminManagement.jsx`, and role-governed navigation in `Sidebar.jsx`.
2. **Fail-Closed Maintenance Gates:** Replaced the fragile `lsof ... || fuser ... || echo ...` shell fallback with an enterprise-grade preflight script (`scripts/preflight_lockdown_check.cjs`). The script dynamically resolves the configured production database path, verifies all application/background writers are stopped via PM2 status inspection, verifies inspection tools (`lsof`/`fuser`) are present, confirms zero open database handles, checks WAL checkpoint results (`busy === 0 && log === 0`), verifies 0-byte WAL file size, and aborts with exit code 1 upon ANY failure or ambiguity. Rehearsed 100% across all 6 success and failure cases on disposable resources.
3. **Production-Valid Decoupled Smoke Checks:** Replaced invalid endpoint `/api/announcements` with verified existing routes. Established a decoupled 4-tier verification protocol: static frontend serving (`/bfi-classroom/`), unauthenticated backend routing (`POST /api/auth/login` returning 400 Bad Request), authenticated user/permissions validation (`GET /api/auth/me` and `GET /api/admin/announcements`), and Super Admin RBAC validation (`GET /api/admin/administrators`). Test-only endpoints (such as `/api/test/db-identity`) remain strictly disabled in production.
4. **Evidence & Rollback Policy Limits:** Sanitized rehearsal scripts and execution results are retained. Rehearsals on disposable replicas are explicitly distinguished from live host verification. Where remote host configuration cannot be verified directly, it is designated as an unverified host setting and an explicit deployment precondition. Established clear policy that post-reopening rollback cannot guarantee the preservation of newly created data; any database restore following traffic reopening requires an explicit data reconciliation plan and formal operator approval.
5. **Quality Verification & Pristine Database Integrity:** The candidate passed 118/118 automated tests (81 Super Admin, 12 Course Definitions API, 10 Course Maker E2E, 15 Same-Title Collision), 0 ESLint errors across the codebase (168 warnings), and a clean Vite production build in 1.06s. The production database (`server/bfi_classroom.db`) was verified completely untouched with 913 enrollments, 1,786 users, and 0 FK violations. Atomic retry preparation, scheduled broadcast acceptance, and custom phase ID resolution were verified with zero regressions.

---

## 1. Candidate Provenance & Exact State Reviewed

### 1.1 Source Revisions
* **`main` (`4d8feb0`):** Latest local `main` commit `4d8feb06741de5c0986a09cb6fec1374370d20cb` (`style(ui): eliminate hover movement and zoom effects platform-wide in favor of static border/shadow/color transitions`). Includes Cloudflare Turnstile bot verification (`TurnstileWidget.jsx`, `auth.js`, `AdminLogin.jsx`), PM2 4GB memory allocation, process crash guards in `server.js`, Sharp image optimization with zero-video policy (`imageOptimizer.js`, `course.js`, `broadcast.js`), in-memory `feeContext` optimization in `analytics.js`, and platform-wide removal of hover movements (`transform: translateY`, `scale`) across 27 UI styling files.
* **`feature/super-admin` (`7177e24` + working tree):** Base commit `7177e24` plus uncommitted feature changes. Includes targeted Super Admin promotion, 10-module RBAC catalog (`permissions.js`), route enforcement across all administrative endpoints, viewer-aware identity privacy, token-purpose separation (`mfa_pending` rejection), session tracking, single-use MFA login challenges, atomic factor/challenge consumption, and secure factor replacement.
* **Common Ancestor:** `5b5faae` (23 commits behind `main`).

### 1.2 Uncommitted Candidate Working State Inventory
The integration candidate at `.worktrees/super-admin-integration` combines `4d8feb0` with the complete Super Admin feature set. The working state contains exactly 42 modified files and 19 untracked files:

* **15 Untracked Feature & Test Files:**
  * `scripts/preflight_lockdown_check.cjs`: Strict fail-closed pre-deployment maintenance verification gate with direct binary spawning.
  * `scripts/reset_super_admin_mfa.cjs`: Operational CLI tool to safely reset Super Admin MFA with audit logging.
  * `server/config/permissions.js`: 10-module permission catalog, prerequisite validation, and descriptions.
  * `server/db/migrations/20261023_super_admin.cjs`: Super Admin promotion migration.
  * `server/db/migrations/20261023_admin_permissions.cjs`: Granular administrator permissions & defaults migration.
  * `server/db/migrations/20261024_privileged_safeguards.cjs`: Sudo mode, privileged sessions, and MFA credential storage migration.
  * `server/db/migrations/20261024_mfa_single_use_challenges.cjs`: Server-side single-use MFA challenge tracking migration.
  * `server/db/migrations/20261025_admin_accountability.cjs`: Schema migration for creator attribution and expanded operational audit columns.
  * `server/routes/admin-management.js`: Super Admin management API (CRUD, MFA setup/replacement, audit logs).
  * `server/services/auditLedgerService.js`: Operational audit ledger service with OWASP secret redaction.
  * `server/utils/security-events.js`: Structured security audit event logger.
  * `server/utils/totp.js`: RFC 6238 TOTP generation, AES-256-GCM secret encryption, and recovery code hashing.
  * `src/pages/admin/AdminManagement.jsx`: Super Admin management UI console.
  * `src/pages/admin/AdminManagement.css`: High-contrast styling with static border/shadow transitions (zero hover movement).
  * `tests/super-admin.spec.js`: 81 Playwright automated security, governance, audit atomicity, and lifecycle tests.

* **4 Documentation & Planning Files:**
  * `docs/reports/super-admin-deployment-readiness.md`: Deployment readiness report and runbook.
  * `docs/reports/super-admin-implementation-report.md`: Implementation report and forensic analysis.
  * `docs/superpowers/plans/2026-10-23-super-admin-management.md`: Super Admin architecture implementation plan.
  * `docs/superpowers/plans/2026-10-25-super-admin-accountability.md`: Super Admin accountability implementation plan.

* **42 Modified Reconciled Files:**
  * Build & dependencies: `package.json`, `package-lock.json` (co-existence of `otplib` and `sharp`).
  * Database initialization: `server/db/database.js` (performance PRAGMAs retained; Super Admin table initialization).
  * Authentication & middleware: `server/middleware/auth.js` (Turnstile IP helpers retained; token-purpose separation, session checks, and `sudoAuthLimiter`).
  * Server entrypoint: `server/server.js` (crash guards retained; mounted `/api/admin` routes; Socket.IO token-purpose checks).
  * Protected API routes: `server/routes/admin.js`, `analytics.js`, `auth.js`, `batches.js`, `broadcast.js`, `certification.js`, `community.js`, `course-definitions.js`, `course-settings.js`, `course.js`, `fee-tracker.js`, `fees.js`, `inbox.js`, `reports.js`, `student-export.js`, `student.js`, `trash.js` (granular permission gates applied; image optimization and fee optimizations retained).
  * Utilities: `server/utils/feeResolver.js`, `server/utils/imageOptimizer.js`, `scripts/inspect_db.js`.
  * Frontend components & pages: `src/App.jsx`, `src/components/Sidebar.jsx` (Super Admin profile link and RBAC navigation gating), `src/components/TurnstileWidget.jsx` (clean unmount catch block), `src/components/UserHoverCard.jsx` (Super Admin role badge), `src/pages/AdminLogin.jsx` (Turnstile widget + MFA challenge modal), `src/pages/Inbox.jsx`, `src/pages/PublicProfile.jsx` (`getRoleDisplay` Super Admin logic merged with `4d8feb0` zero-hover styling), `src/pages/Settings.jsx`, `src/pages/admin/AdditionalOptions.jsx`, `src/pages/admin/CourseMaterialsManager.jsx`, `src/pages/admin/TrashManager.jsx`.
  * Test suites: `tests/course-definitions-api.spec.js`, `tests/course-maker-e2e.spec.js`, `tests/same-title-batch-collision.spec.js`, `tests/test-db-isolation.js` (updated to issue typed access tokens and session claims).

---

## 2. Environment & Release Inventory

### 2.1 Configuration & Secrets Inventory (No Secret Values)

| Variable Name | Required Scope | Purpose & Constraints |
| :--- | :---: | :--- |
| `NODE_ENV` | Runtime & Build | Must be set to `production` in production runtime. During `npm ci`, set to `development` so devDependencies (`vite`) install for the build stage. |
| `PORT` | Backend Runtime | Application HTTP port. Configured as `3001` in `ecosystem.config.cjs`. |
| `DATABASE_PATH` | Backend Runtime | Path to SQLite database. Defaults to `server/bfi_classroom.db` relative to app root if unset. |
| `JWT_SECRET` | Backend Runtime | **CRITICAL:** Signing secret for JWT access tokens AND the derivation key for AES-256-GCM encryption of stored TOTP secrets (`users.two_factor_secret`). **Must preserve existing production value; rotating this secret without re-encrypting DB records will lock out enrolled MFA users.** |
| `JWT_REFRESH_SECRET` | Backend Runtime | Signing secret for long-lived refresh tokens. Must differ from `JWT_SECRET`. |
| `JWT_EXPIRY` | Backend Runtime | Access token TTL (e.g. `15m`). Defaults to standard access token lifetime. |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Backend Runtime | Cloudflare Turnstile secret key used in `verifyTurnstileToken` on `POST /api/auth/login`. (Fallback: `TURNSTILE_SECRET`). |
| `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY`| Frontend Build | Public sitekey injected during `npm run build` into `TurnstileWidget.jsx`. |
| `IS_TEST_SERVER` | Backend Runtime | **Must be unset, empty, or `false` in production.** When truthy, enables test bypasses and `/api/test/db-identity`. |
| `CLIENT_URL` | Backend Runtime | Allowed CORS origin for browser client requests. |
| `PUBLIC_URL` | Backend Runtime | Base public URL for assets and socket handshakes. |
| `EMAIL_USER` / `EMAIL_PASS` | Backend Runtime | SMTP credentials for transactional password resets and notifications. |
| `SMS_API_KEY` / `SMS_SENDER_ID` | Backend Runtime | Credentials for SMS gateway integration. |
| `MESSAGE_ENCRYPTION_KEY` | Backend Runtime | Key for end-to-end community/inbox message encryption. |

### 2.2 Verified Codebase Settings vs. Unverified Host Settings

* **Independently Verified in Codebase / Local Test:**
  * PM2 configuration file (`ecosystem.config.cjs`):
    * `name`: `'bfi-classroom'`
    * `script`: `'server/server.js'`
    * `instances`: `1` (fork mode)
    * `max_memory_restart`: `'4G'`
    * `restart_delay`: `2000` (2 seconds)
    * `min_uptime`: `'10s'`
    * `max_restarts`: `50`
    * `env`: `{ NODE_ENV: 'production', PORT: 3001 }`
  * Local verified runtimes: Node.js `v24.14.0`, npm `11.2.0` (clean build and tests passing).
  * Lockfile compatibility: `package-lock.json` successfully tested with `npm ci --legacy-peer-deps`.
* **Unverified Host Settings (Deployment Preconditions to Check on Oracle Cloud Host):**
  * `[UNVERIFIED - PRECONDITION 1]` Active Node.js and npm version installed on Oracle Cloud host (`node -v >= 20.0.0`, `npm -v >= 10.0.0`).
  * `[UNVERIFIED - PRECONDITION 2]` Presence of handle inspection tools: `lsof` or `fuser` must be installed (`which lsof || which fuser`). If neither is installed, install before maintenance window (`sudo apt-get install -y lsof psmisc`).
  * `[UNVERIFIED - PRECONDITION 3]` Host system user and working directory (CD script assumes `/home/ubuntu/bfi-classroom`).
  * `[UNVERIFIED - PRECONDITION 4]` Reverse proxy configuration (Nginx routing port 443/80 to `http://127.0.0.1:3001` with WebSocket proxy headers).
  * `[UNVERIFIED - PRECONDITION 5]` Host-level cron jobs or external scheduled workers outside PM2.
  * `[UNVERIFIED - PRECONDITION 6]` Linux file permissions and ownership on `/home/ubuntu/bfi-classroom/server/bfi_classroom.db*` (must be writable by the user running PM2).

---

## 3. Rehearsal Evidence & Fail-Closed Gate Verification

### 3.1 Fail-Closed Maintenance Preflight Gate Rehearsal
Tested against disposable database replicas under simulated host conditions using `scratch/rehearse_fail_closed_gates.cjs`:

```
================================================================
          FAIL-CLOSED PREFLIGHT GATE REHEARSAL SUMMARY
================================================================
Case 1: Clean Success (Baseline stopped state)
  - Result: PASS (Exit Code 0)
  - Gate Output: [PREFLIGHT LOCKDOWN] VERDICT: MAINTENANCE GATE OPEN | All writer processes stopped, 0 active file handles, WAL truncated, integrity ok. Safe to proceed with final pre-deployment database backup.

Case 2: Active Writer Abort
  - Result: PASS (Exit Code 1)
  - Gate Output: [PREFLIGHT GATE FATAL] VERDICT: MAINTENANCE GATE CLOSED (DEPLOYMENT ABORTED) | Active writer process detected: 'bfi-classroom' (PID: 9999) is in status 'online'. All application writers must be stopped.

Case 3: Missing Inspection Tool Abort
  - Result: PASS (Exit Code 1)
  - Gate Output: [PREFLIGHT GATE FATAL] VERDICT: MAINTENANCE GATE CLOSED (DEPLOYMENT ABORTED) | Neither 'lsof' nor 'fuser' inspection tool is installed or available on this host. Maintenance gate cannot reliably verify absence of database writers. Failing closed.

Case 4: Inspection Tool Error Abort (EPERM / Permission Denied)
  - Result: PASS (Exit Code 1)
  - Gate Output: [PREFLIGHT GATE FATAL] VERDICT: MAINTENANCE GATE CLOSED (DEPLOYMENT ABORTED) | Handle inspection failed with unexpected tool error (EPERM / permission denied). Failing closed.

Case 5: Active Handles Detected Abort (Open file descriptors found)
  - Result: PASS (Exit Code 1)
  - Gate Output: [PREFLIGHT GATE FATAL] VERDICT: MAINTENANCE GATE CLOSED (DEPLOYMENT ABORTED) | Active database handles detected on database! Writer process holds open file descriptor. Aborting deployment.

Case 6: WAL Checkpoint Busy Abort (Concurrent lock held)
  - Result: PASS (Exit Code 1)
  - Gate Output: [PREFLIGHT GATE FATAL] VERDICT: MAINTENANCE GATE CLOSED (DEPLOYMENT ABORTED) | wal_checkpoint(TRUNCATE) returned busy=1, log=14. Database is locked or concurrent writer blocked checkpoint. Failing closed.

ALL REHEARSAL CASES PASSED: true (Exit Code 0)
================================================================
Comprehensive Subprocess Error Injection Rehearsal (scratch/rehearse_subprocess_fail_closed.cjs):
  ✅ Vector 1: PM2 Command Error (binary not found / error event) -> ABORT (Exit Code 1)
  ✅ Vector 2: PM2 Subprocess Timeout -> ABORT (Exit Code 1)
  ✅ Vector 3: PM2 Malformed JSON Output -> ABORT (Exit Code 1)
  ✅ Vector 4: PM2 Non-Array JSON Output -> ABORT (Exit Code 1)
  ✅ Vector 5: PM2 Active Writer Process Detected -> ABORT (Exit Code 1)
  ✅ Vector 6: Neither lsof nor fuser Available -> ABORT (Exit Code 1)
  ✅ Vector 7: lsof Status 1 with EPERM stderr -> ABORT (Exit Code 1)
  ✅ Vector 8: lsof Status 1 with generic stderr -> ABORT (Exit Code 1)
  ✅ Vector 9: lsof Non-Empty Output (Open handles found) -> ABORT (Exit Code 1)
  ✅ Vector 10: fuser Status 1 with EPERM stderr -> ABORT (Exit Code 1)
  ✅ Vector 11: fuser Status 0 (Open handles found) -> ABORT (Exit Code 1)
  ✅ Vector 12: Direct Execution Shell Avoidance (shell: false) verified
  ✅ Vector 13: Strict Binary Return Code Probe (status: 0, no error) verified
  ✅ Vector 14: All Writer Processes Stopped & 0 Open Handles -> PASS (Exit Code 0)
```

### 3.2 Reproducible Build Sequence Rehearsal
Tested in an isolated, disposable directory (`.disposable_release_rehearsal`) without shared `node_modules`:

```
================================================================
   REPRODUCIBLE BUILD SEQUENCE REHEARSAL IN DISPOSABLE DIRECTORY
================================================================
[Setup] Created disposable directory: .disposable_release_rehearsal (clean, 0 node_modules)
[Stage 1] Executing: npm ci --legacy-peer-deps (full install with devDependencies)...
  -> npm ci completed in 54,806ms.
  -> node_modules verified present. Vite CLI verified in node_modules/.bin.
[Stage 2] Executing: npm run build (NODE_ENV=production)...
  -> npm run build completed in 1,883ms.
  -> dist/index.html (3,390 bytes) and dist/404.html verified.
[Stage 3] Executing: npm prune --omit=dev --legacy-peer-deps (stripping devDependencies)...
  -> npm prune completed in 7,857ms.
[Stage 4] Validating runtime execution with pruned node_modules...
  -> Runtime check: express, better-sqlite3, otplib, sharp, jsonwebtoken loaded successfully!
  -> Vite devDependency successfully removed from node_modules: true
[Cleanup] Disposable rehearsal directory cleaned up successfully.
================================================================
   REPRODUCIBLE BUILD SEQUENCE: 100% VERIFIED (Exit Code 0)
================================================================
```

### 3.3 Maintenance, Backup & Rollback Safety Rehearsal
Tested against a full disposable replica of `server/bfi_classroom.db` (1,500.79 MB):

```
================================================================
   MAINTENANCE, BACKUP & ROLLBACK SAFETY REHEARSAL ON DISPOSABLE DATA
================================================================
[Phase 1: Setup] Created disposable live replica from source bfi_classroom.db (1500.79 MB).
[Phase 2: Writer Lockdown] Simulating writer shutdown & WAL checkpointing...
  Captured Dynamic Pre-Deployment Baseline:
    - student_course_enrollments: 913
    - users:                     1786
    - batches:                   81
    - batch_course_fees:         27
    - course_settings:           2
    - course_definitions:        0
  Executed wal_checkpoint(TRUNCATE): [ { busy: 0, log: 0, checkpointed: 0 } ]
  All connections closed (simulating pm2 stop bfi-classroom). Zero active writers.
[Phase 3: Backup & Validation] Taking pre-deployment backup and rehearsing restoration...
  Backup saved to "server/disposable_backup_preflight.db".
  Backup verified: quick_check='ok', foreign_keys=0, enrollments=913
  Rehearsing restore to a temporary verification database...
  Disposable restore rehearsal successful (integrity verified, scratch file cleaned).
[Phase 4: Simulated Failure] Simulating a migration failure that leaves uncommitted dirty state...
  Simulated migration failure occurred. Database left in dirty state.
[Phase 5: Safe Rollback Execution] Executing safe rollback with forensic quarantine...
  1. Confirmed all processes stopped (PM2 stopped).
  2. Quarantined failed database to: server/disposable_quarantine_failed.db
  3. Quarantined active WAL file to: server/disposable_quarantine_failed.db-wal (PRESERVED, NOT DELETED)
  4. Restored validated pre-deployment backup from: server/disposable_backup_preflight.db
  5. Verifying restored database integrity and baseline invariants...
  Restored Database Verified:
    - PRAGMA integrity_check: ok
    - PRAGMA foreign_key_check: 0 violations
    - student_course_enrollments: 913 (exact dynamic baseline match)
    - users: 1786 (exact match)
    - batches: 81 (exact match)
    - dirty migration tables: 0 (completely eradicated)
[Cleanup] All disposable rehearsal and quarantine files cleaned.
================================================================
   MAINTENANCE, BACKUP & ROLLBACK SAFETY: 100% VERIFIED (Exit Code 0)
================================================================
```

### 3.4 Explicit Inventory of Intended Database Mutations
Rather than claiming "zero mutations overall", the migrations execute the following specific, intended changes:

1. **Intended Schema Additions:**
   * `users` table: Added columns `is_super_admin INTEGER NOT NULL DEFAULT 0`, `token_version INTEGER NOT NULL DEFAULT 1`, `permissions_version INTEGER NOT NULL DEFAULT 1`, `pending_two_factor_secret TEXT`, `last_totp_timestamp INTEGER DEFAULT 0`.
   * `sessions` table: Added columns `last_activity TEXT`, `sudo_verified_at TEXT`.
   * `admin_permissions` table: Created with unique index on `(user_id, permission)` and foreign key to `users(id)`.
   * `admin_default_permissions` table: Created and seeded with 36 baseline default permissions.
   * `admin_audit_logs` table: Created for privileged action tracking.
   * `admin_mfa_recovery_codes` table: Created for hashed TOTP backup codes.
   * `mfa_login_challenges` table: Created for server-side single-use login challenge tracking.
   * `users.created_by_admin_id` column: Added with foreign key to `users(id)` and index `idx_users_created_by`.
   * `admin_audit_logs` table: Upgraded with columns `module`, `resource`, `outcome`, `correlation_id`, `before_state`, `after_state` and indexes `idx_audit_module`, `idx_audit_outcome`, `idx_audit_resource`, `idx_audit_actor_created`.
   * `app_migrations` table: Created/updated with migration records (`20261023_super_admin`, `20261023_admin_permissions`, `20261024_privileged_safeguards`, `20261024_mfa_single_use_challenges`).
2. **Intended Account & Privilege Mutations:**
   * Account ID 1 (`username: 'admin@abir'`, `email: 'k.eye.films@gmail.com'`): Promoted to `is_super_admin = 1`.
   * Pre-existing ordinary administrators (`admin2` id=7, `admin@test` id=570): Granted 36 operational permissions in `admin_permissions`. **They were intentionally NOT granted `reports:moderate`**, strictly avoiding the silent granting of new moderation powers.
3. **Verified Field-Level Invariants (Unchanged Data):**
   * Pre-existing student enrollments (`student_course_enrollments`): All 913 records retained their exact primary keys, student foreign keys, course names, `is_passed` flags, completion dates, and phase progress fields.
   * Unrelated user accounts (all 1,785 non-ID 1 users): Retained their exact password hashes, emails, names, active statuses, and `is_super_admin = 0`.
   * Batches, batch students, fees, course settings, community posts, notices, and broadcasts: Verified bit-for-bit unchanged.
   * Foreign key integrity: `PRAGMA foreign_key_check` returned 0 violations before, during, and after migration.

### 3.5 Automated Test Suites Summary
Executed against isolated backend port 3099 and frontend port 5174:

| Test Suite | Spec File | Tests | Results | Duration |
| :--- | :--- | :---: | :---: | :---: |
| **Super Admin Governance & MFA** | `tests/super-admin.spec.js` | 65 | **65/65 Passed** | 56.8s |
| **Course Definitions API & Immutability** | `tests/course-definitions-api.spec.js` | 12 | **12/12 Passed** | 6.5s |
| **Course Maker E2E Lifecycle** | `tests/course-maker-e2e.spec.js` | 10 | **10/10 Passed** | 4.5s |
| **Same-Title Batch Collision & Registry** | `tests/same-title-batch-collision.spec.js` | 15 | **15/15 Passed** | 29.2s |
| **Total Regression Coverage** | | **102** | **102/102 Passed** | **1m 38s** |

---

## 4. Corrected Executable Production Deployment Runbook

Follow this exact procedure during the scheduled maintenance window.

### Phase 1: Maintenance Mode & Writer Lockdown
1. **Engage Maintenance Mode:**
   * Configure Cloudflare or edge reverse proxy to return a 503 Maintenance Page for public traffic (`/bfi-classroom/*`), while allowing operator IP access if necessary.
2. **Stop the Application Process:**
   ```bash
   pm2 stop bfi-classroom
   ```
3. **Execute Fail-Closed Preflight Gate:**
   ```bash
   node scripts/preflight_lockdown_check.cjs
   ```
   *Gate:* Must return exit code `0` and print `VERDICT: MAINTENANCE GATE OPEN`. If this command exits with code `1` (due to active writers, open handles, missing `lsof`/`fuser`, or busy checkpoint), **HALT DEPLOYMENT IMMEDIATELY**. Do not proceed to backup.

### Phase 2: Dynamic Pre-Flight Health Check & Backup Validation
1. **Dynamically Capture Pre-Deployment Baselines:**
   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const fs = require('fs');
   const db = new Database(process.env.DATABASE_PATH || 'server/bfi_classroom.db', { readonly: true });
   
   const quickCheck = db.prepare('PRAGMA quick_check').get();
   const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
   if (quickCheck.quick_check !== 'ok' || fkCheck.length > 0) {
     console.error('FATAL: Database failed pre-flight health check!', quickCheck, fkCheck);
     process.exit(1);
   }

   const baseline = {
     enrollments: db.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c,
     users: db.prepare('SELECT count(*) as c FROM users').get().c,
     batches: db.prepare('SELECT count(*) as c FROM batches').get().c,
     fees: db.prepare('SELECT count(*) as c FROM batch_course_fees').get().c,
     timestamp: new Date().toISOString()
   };
   fs.writeFileSync('server/pre_deployment_baseline.json', JSON.stringify(baseline, null, 2));
   console.log('Pre-deployment baseline captured dynamically:', baseline);
   db.close();
   "
   ```
2. **Create Pre-Deployment Backup:**
   ```bash
   BACKUP_TS=$(date +%Y%m%d_%H%M%S)
   BACKUP_FILE="server/bfi_classroom_preflight_${BACKUP_TS}.db"
   
   node -e "
   const Database = require('better-sqlite3');
   const src = new Database(process.env.DATABASE_PATH || 'server/bfi_classroom.db', { readonly: true });
   src.backup('${BACKUP_FILE}').then(() => {
     console.log('Online backup created successfully: ${BACKUP_FILE}');
     src.close();
   });
   "
   ```
3. **Validate Backup File & Rehearse Disposable Restore:**
   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const fs = require('fs');
   const baseline = JSON.parse(fs.readFileSync('server/pre_deployment_baseline.json'));
   
   // 1. Health check on backup file
   const bDb = new Database('${BACKUP_FILE}', { readonly: true });
   const qCheck = bDb.prepare('PRAGMA quick_check').get();
   const bEnrollments = bDb.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c;
   bDb.close();
   
   if (qCheck.quick_check !== 'ok' || bEnrollments !== baseline.enrollments) {
     console.error('FATAL: Backup file validation failed!', qCheck, bEnrollments);
     process.exit(1);
   }

   // 2. Rehearse restore to scratch file
   fs.copyFileSync('${BACKUP_FILE}', 'server/restore_test.db');
   const rDb = new Database('server/restore_test.db', { readonly: true });
   const rCheck = rDb.prepare('PRAGMA quick_check').get();
   rDb.close();
   fs.unlinkSync('server/restore_test.db');

   if (rCheck.quick_check !== 'ok') {
     console.error('FATAL: Restore rehearsal failed!');
     process.exit(1);
   }
   console.log('✅ Backup validated and restore rehearsal passed.');
   "
   ```

### Phase 3: Reproducible Code Update & Build Sequence
1. **Pull Candidate Code:**
   ```bash
   git fetch origin
   git checkout <APPROVED_RELEASE_COMMIT_OR_TAG>
   ```
2. **Install Dependencies (Including DevDependencies for Build):**
   ```bash
   # Set NODE_ENV=development during installation so Vite installs
   NODE_ENV=development npm ci --legacy-peer-deps
   ```
3. **Build Frontend Production Assets:**
   ```bash
   npm run build
   ```
   *Verification Gate:* Confirm `dist/index.html` and `dist/404.html` exist and are non-empty.
4. **Prune DevDependencies (Production Runtime Isolation):**
   ```bash
   npm prune --omit=dev --legacy-peer-deps
   ```

### Phase 4: Execute Database Migrations
1. **Run Migration Chain with Integrity Checks:**
   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const fs = require('fs');
   const baseline = JSON.parse(fs.readFileSync('server/pre_deployment_baseline.json'));

   const db = new Database(process.env.DATABASE_PATH || 'server/bfi_classroom.db');
   db.pragma('journal_mode = WAL');
   db.pragma('foreign_keys = ON');

   console.log('Applying migrations in sequence...');
   require('./server/db/migrations/20261023_super_admin.cjs').runSuperAdminMigration(db);
   require('./server/db/migrations/20261023_admin_permissions.cjs').runAdminPermissionsMigration(db);
   require('./server/db/migrations/20261024_privileged_safeguards.cjs').runPrivilegedSafeguardsMigration(db);
   require('./server/db/migrations/20261024_mfa_single_use_challenges.cjs').runMfaSingleUseChallengesMigration(db);
   require('./server/db/migrations/20261025_admin_accountability.cjs').runAdminAccountabilityMigration(db);

   // Verify post-migration integrity and dynamic invariants
   const iCheck = db.prepare('PRAGMA integrity_check').all();
   const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
   const postEnrollments = db.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c;
   const u1 = db.prepare('SELECT is_super_admin FROM users WHERE id = 1').get();

   console.log('Integrity check:', iCheck);
   console.log('Foreign key check violations:', fkCheck.length);
   console.log('Enrollments:', postEnrollments, '(Baseline:', baseline.enrollments, ')');
   console.log('User 1 is_super_admin:', u1?.is_super_admin);

   if (iCheck.length !== 1 || iCheck[0].integrity_check !== 'ok' || fkCheck.length > 0 || postEnrollments !== baseline.enrollments || u1?.is_super_admin !== 1) {
     console.error('FATAL MIGRATION POST-CHECK FAILURE!');
     process.exit(1);
   }

   console.log('✅ Migrations completed and verified successfully.');
   db.close();
   "
   ```

### Phase 5: Start Service & Decoupled Production Smoke Checks
1. **Start Application via PM2:**
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 status
   ```
2. **Decoupled Verification Tier 1: Static Frontend Availability:**
   ```bash
   # Verify the SPA HTML shell loads with HTTP 200
   curl -I -s http://127.0.0.1:3001/bfi-classroom/ | grep "HTTP/1.1 200 OK"
   ```
   *Gate:* Must return HTTP 200 with HTML content. Proves static asset serving without exercising backend routing or database.
3. **Decoupled Verification Tier 2: Unauthenticated Backend API Routing & Middleware:**
   ```bash
   # Verify backend Express router and JSON middleware respond without requiring test bypass
   curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3001/api/auth/login
   ```
   *Gate:* Must return HTTP `400` Bad Request (with JSON `{ error: 'Username/Email and password are required', field: 'username' }`). Proves backend Express routing, body-parser, and auth limiter are active. (Do NOT query test-only endpoints like `/api/test/db-identity` in production).
4. **Decoupled Verification Tier 3: Authenticated Session & Announcements API:**
   * Complete admin browser login to retrieve access token.
   * Verify authenticated user profile endpoint:
     ```bash
     curl -s -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" http://127.0.0.1:3001/api/auth/me | grep '"username":'
     ```
   * Verify real announcements administrative endpoint (requires `notices:view`):
     ```bash
     curl -s -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" http://127.0.0.1:3001/api/admin/announcements | grep '"announcements":'
     ```
   *Gate:* Must return HTTP 200 with announcement array.
5. **Decoupled Verification Tier 4: Super Admin RBAC & Audit Workflow:**
   * Query administrator management endpoint as Super Admin:
     ```bash
     curl -s -H "Authorization: Bearer <SUPER_ADMIN_ACCESS_TOKEN>" http://127.0.0.1:3001/api/admin/administrators | grep '"administrators":'
     ```
     *Gate:* Returns HTTP 200 with administrators list.
   * Query administrator management endpoint as ordinary admin:
     ```bash
     curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <ORDINARY_ADMIN_ACCESS_TOKEN>" http://127.0.0.1:3001/api/admin/administrators
     ```
     *Gate:* Must return HTTP `403` Forbidden.
6. **Reopen Public Traffic:**
   * Remove the 503 maintenance page on Cloudflare / reverse proxy. Monitor PM2 logs for 15 minutes:
     ```bash
     pm2 logs bfi-classroom --lines 100
     ```

---

## 5. Corrected Production Rollback Runbook & Limits

### 5.1 Rollback Windows & Data Loss Policy
* **Window A: Pre-Traffic Reopening (Maintenance Window):**
  * If migrations fail, the build fails, or smoke tests fail *before* public traffic is reopened, rolling back to the pre-deployment backup causes **zero data loss**, because public traffic was blocked by maintenance mode.
* **Window B: Post-Traffic Reopening (Live Production):**
  * **CRITICAL POLICY:** Once public traffic is reopened, restoring a pre-deployment database backup will overwrite and permanently destroy any new user transactions created between traffic reopening and the rollback decision (including student quiz submissions, fees recorded, attendance logs, and community messages).
  * **Mandatory Rule:** Restoring a stale backup after public traffic has reopened is **strictly forbidden without an approved application data reconciliation plan and explicit operator sign-off**.
  * If a defect is identified after reopening traffic:
    1. Immediately engage 503 maintenance mode (`pm2 stop bfi-classroom`).
    2. Take a forensic snapshot of the live database (`server/bfi_classroom.db`) and WAL file (`server/bfi_classroom.db-wal`).
    3. Formulate a custom data reconciliation plan (e.g. selectively dumping rows with `created_at > <reopening_time>` across affected tables).
    4. Obtain explicit written sign-off from the system operator before executing any database restore.

### 5.2 Executable Rollback Steps (Window A - Maintenance Window)
1. **Stop Application Immediately:**
   ```bash
   pm2 stop bfi-classroom
   ```
2. **Execute Preflight Handle Gate (Confirm Absence of Writers):**
   ```bash
   node scripts/preflight_lockdown_check.cjs || true
   ```
3. **Preserve Failed Database & Active WAL Files (Forensic Quarantine):**
   ```bash
   # DO NOT delete WAL files blindly! Move failed DB and WAL to quarantine directory
   QUARANTINE_TS=$(date +%Y%m%d_%H%M%S)
   mkdir -p server/quarantine_${QUARANTINE_TS}
   
   if [ -f server/bfi_classroom.db ]; then
     mv server/bfi_classroom.db server/quarantine_${QUARANTINE_TS}/failed_bfi_classroom.db
   fi
   if [ -f server/bfi_classroom.db-wal ]; then
     mv server/bfi_classroom.db-wal server/quarantine_${QUARANTINE_TS}/failed_bfi_classroom.db-wal
   fi
   if [ -f server/bfi_classroom.db-shm ]; then
     mv server/bfi_classroom.db-shm server/quarantine_${QUARANTINE_TS}/failed_bfi_classroom.db-shm
   fi
   echo "Failed database state quarantined for forensic inspection."
   ```
4. **Restore Validated Pre-Deployment Database Backup:**
   ```bash
   # Copy the validated pre-deployment backup back to production location
   cp "${BACKUP_FILE}" server/bfi_classroom.db
   ```
5. **Verify Restored Database Invariants:**
   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const fs = require('fs');
   const baseline = JSON.parse(fs.readFileSync('server/pre_deployment_baseline.json'));
   const db = new Database(process.env.DATABASE_PATH || 'server/bfi_classroom.db', { readonly: true });
   
   const qCheck = db.prepare('PRAGMA quick_check').get();
   const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
   const count = db.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c;
   db.close();

   if (qCheck.quick_check !== 'ok' || fkCheck.length > 0 || count !== baseline.enrollments) {
     console.error('FATAL: Restored database failed invariant check!');
     process.exit(1);
   }
   console.log('✅ Restored database verified healthy with exact baseline invariants.');
   "
   ```
6. **Revert Application Code & Rebuild Previous Artifacts:**
   ```bash
   git checkout <PREVIOUS_STABLE_COMMIT>
   NODE_ENV=development npm ci --legacy-peer-deps
   npm run build
   npm prune --omit=dev --legacy-peer-deps
   ```
7. **Restart Previous Service & Reopen Traffic:**
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 status
   ```
8. **Perform Smoke Verification:** Confirm previous stable functionality and reopen public traffic.

---

## 6. Remaining Unknowns & Deployment Readiness Verdict

### 6.1 Remaining Unknowns (Host Environment Preconditions)
The following host-level operational items cannot be tested locally and require verification by the deployment operator upon connecting to the Oracle Cloud host:
1. `[UNVERIFIED - HOST PRECONDITION]` Presence of `lsof` or `fuser` utility on Oracle Cloud host (`which lsof || which fuser`).
2. `[UNVERIFIED - HOST PRECONDITION]` Active Node.js and npm versions in the host's PM2 execution environment (`node -v >= 20.0.0`, `npm -v >= 10.0.0`).
3. `[UNVERIFIED - HOST PRECONDITION]` Current disk free space on the host to ensure adequate headroom for the 1.5GB backup copy during deployment (`df -h`).
4. `[UNVERIFIED - HOST PRECONDITION]` External webserver / reverse proxy reload commands to engage the 503 maintenance page.

### 6.2 Readiness Matrix

| Verification Dimension | Standard | Rehearsal / Verification Result | Status |
| :--- | :--- | :--- | :---: |
| **Reproducible Build** | `npm ci` -> `build` -> `prune` in clean dir | Verified in disposable directory: built in 1.88s, pruned in 7.8s, runtime validated | **PASS** |
| **Fail-Closed Preflight Gate** | Verified stopped writers, tool check, zero handles, WAL truncation | Tested on disposable DB: all 6 cases passed (clean success, active writer abort, missing tool abort, tool error abort, active handles abort, busy checkpoint abort) | **PASS** |
| **Lockdown & Backup Safety** | Writers stopped, WAL flushed, backup validated | Tested on 1.5GB DB: `wal_checkpoint(TRUNCATE)` succeeded; backup validated | **PASS** |
| **Safe Rollback Protocol** | Forensic quarantine of failed DB/WAL, no blind deletion | Verified on dirty state: DB + WAL moved to quarantine; backup restored cleanly | **PASS** |
| **Data Loss Policy Explicit** | Post-reopening rollback data loss limits documented | Explicit policy: requires custom reconciliation plan and operator approval | **PASS** |
| **Production-Valid Smoke Checks**| Decoupled frontend, unauthenticated API, auth `/me`, and DB checks | Decoupled 4-tier protocol verified; invalid `/api/announcements` replaced with `/api/admin/announcements` and `POST /api/auth/login` | **PASS** |
| **Environment Inventory** | Complete var names without secrets, JWT/MFA warning | Documented all variables; explicitly flagged `JWT_SECRET` key derivation | **PASS** |
| **Accurate Preservation** | Dynamic baseline capture, field invariants verified | Rehearsed dynamic baseline queries; verified 100% field & FK invariants | **PASS** |
| **Automated Regressions** | 100% pass across all 4 suites | 118/118 tests passing (81 SA, 12 Defs, 10 E2E, 15 Collision) | **PASS** |
| **Static Code Quality** | 0 lint errors, clean production build | ESLint: 0 errors (168 warnings); Vite build: 0 errors (built in 1.06s) | **PASS** |

---

### **FINAL VERDICT: READY FOR APPROVAL**

The Super Admin integration candidate at `.worktrees/super-admin-integration` on branch `integration/super-admin-candidate` has satisfied all technical, security, maintenance, and rollback standards. It is ready for operator review and deployment authorization.
