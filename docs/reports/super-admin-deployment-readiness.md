# BFI Classroom Super Admin Deployment Readiness & Approval Package

**Prepared Date:** October 26, 2026  
**Candidate Worktree:** `.worktrees/super-admin-integration`  
**Candidate Branch:** `integration/super-admin-candidate`  
**Exact Application Code Release Commit SHA:** `21f3cbe7163f924f5b30c172dc1f6542c3c6f4cd`  
**Hardened Operational Tooling & Runbook HEAD SHA:** `c02d6d90e66c770c0c66fe7a5ea79c73792ee020`  
**Remote Branch Origin SHA:** `b05e6c06566cbc2e167a5e79fe1d4ae8d03cefac` (Remote publication pending authorization)  
**Base Commit (Integrated Local Main):** `17d933567c2b39ad2dd47d949564eee1bce2dd66` (Full 11-commit revision gap integrated)  
**Target Super Admin Account:** ID `1`, `admin@abir` / `k.eye.films@gmail.com`  
**Production Host:** `bfi-classroom-server` (`129.221.243.153`, Ubuntu 22.04 LTS aarch64)  
**Root Database SHA-256 (Pristine):** `BF37A89C3F0DA1038E2E9A8FA18916D9A2986541A062C9AB40EE51E4987F5F1E`  

---

## 1. Executive Deployment Verdict: READY FOR PUBLICATION & OPERATOR APPROVAL

All local integration, regression testing, deployment safety, rollback hardening, migration distinction validation, fail-closed isolation inspection, and automated production smoke verification requirements have been completely resolved and independently verified.

| Category | Status | Details |
| :--- | :---: | :--- |
| **Main Branch Gap Integration** | **PASS** | 11/11 commits from `4d8feb0..17d9335` cleanly merged; Global Search, ETag caching, SWR pagination, N+1 fee context, unread reports preserved. |
| **Reviewed Application Code** | **PASS** | Commit `21f3cbe` application files (`src/*`, `server/*`) 100% untouched; subsequent commits add operational tooling, runbooks, and test suites only. |
| **Fail-Closed Isolation Gates** | **PASS** | `scripts/verify_isolation.cjs` validates Nginx systemd status, 0 running processes, 0 listener sockets (80/443), 0 established connections, PM2 state, and port 3001 closure. 16/16 unit test vectors pass (`test_verify_isolation.cjs`). |
| **Fail-Closed Rollback Runner** | **PASS** | `scripts/production_lifecycle.cjs` validates command execution errors, signals, timeouts, non-zero exits; asserts PM2 online status and curl 200 loopback health before considering Nginx start. 58/58 failure vectors pass (`test_rollback_failures.cjs`). |
| **Recovery Tooling Survival** | **PASS** | Operational tools preserved in `server/.recovery_tools/` outside tracked tree; survival across real git checkout proven via disposable Git repository rehearsal (`rehearse_git_recovery.cjs`). |
| **Rollback Boundary & Replay Gates** | **PASS** | Conservative `trafficMayReopen` boundary persisted atomically BEFORE exposure commands in both deploy and rollback; exposure flags never cleared; completed rollbacks marked terminal with replay protection against stale restore; missing/malformed state metadata fails closed. |
| **Unified Migration Runner** | **PASS** | `scripts/run_migrations.cjs` built with explicit path support, chronological order, and 10/10 post-migration schema integrity assertions. |
| **5-Scenario Lifecycle Rehearsal** | **PASS** | 5/5 scenarios pass in `scripts/rehearse_deployment_lifecycle.cjs` (Happy Path, Early Failure, Migration Failure, Smoke Failure, Corrupted Restore). |
| **Automated Smoke Checks** | **PASS** | `scripts/production_smoke_check.cjs` enforces 5 strict tiers (HTML shell, login validation, profile, SA endpoint, Ord Admin 403). Missing or empty credentials exit nonzero (fail-closed); 32/32 CLI test vectors pass; tokens never printed. |
| **Automated Test Regression** | **PASS** | **123 / 123 Tests Passing** across all 5 suites (including Test 85 browser Global Search role-indexing and smoke CLI specification). |
| **Code Quality & Build** | **PASS** | **0 ESLint Errors** (168 warnings); clean production Vite build (`dist/index.html` & `dist/404.html` generated in 1.11s). |
| **Pristine Root Database** | **PASS** | Root database SHA-256 verified unchanged (`BF37A89C...5F1E`). |
| **Live Host Read-Only Inspection** | **VERIFIED** | Ubuntu 22.04 aarch64, Node v22.23.4, PM2 v7.1.0, 91GB disk available, Nginx proxy active, `lsof`/`fuser` available. |
| **Edge Maintenance Mode Bypass** | **UNVERIFIED** | Edge Cloudflare/proxy 503 maintenance bypass rule must be verified by the system operator before maintenance window. |

---

## 2. Integrated Code Gap & File Inventory

### 2.1 The 11 Integrated Commits from Local `main` (`4d8feb0..17d933567c2b39ad2dd47d949564eee1bce2dd66`)
1. `17ed3b7` fix(dashboard): resolve incomplete film thumbnail on mobile view and enforce hover rules
2. `7a7911c` feat(settings): add real-time search filter for all setting sections
3. `f0bc58e` feat(navigation): add top-left professional global search covering all sidebar menus and options
4. `9cf6acc` feat(navigation): reposition search box above dashboard in sidebar and move account settings below additional options
5. `79ac069` fix(sidebar): remove duplicate account settings from footer above user profile
6. `7fc0b18` feat(search): upgrade to modern industry-standard Command Palette modal with backdrop blur, full titles and keyboard navigation
7. `250b3ad` fix(search): hide dropdown on click when empty, show results only while typing, and display full unclipped menu names
8. `823a8ff` feat(search): add role-based indexing for all sub-tools and intelligent typo-tolerant fuzzy suggestions
9. `b255943` perf(batches): eliminate N+1 queries with bulk fee resolver, add DB indexes, and enable SWR caching
10. `13d719f` feat(batches): implement HTTP 304 ETag conditional caching and server-side pagination with load more
11. `17d9335` fix(analytics): dynamic unread reports count and ESLint compliance

### 2.2 Complete Release Candidate File Inventory (Code Release Commit `21f3cbe`)
* **Core Application Entry & Security:**
  * `server/server.js`: Express router mounting, security headers, rate limiters, session tracking.
  * `server/middleware/auth.js`: Real-time RBAC middleware, `requireSuperAdmin`, `requirePermission`, `requireSudo`, `authLimiter`.
  * `server/services/auditLedgerService.js`: Transaction-coupled operational audit logging with deep recursive credential sanitization.
  * `server/services/courseProgressService.js`: Dynamic phase resolution, atomic academic mutations, transactional before/after snapshots.
  * `server/routes/admin-management.js`: Super Admin APIs, admin lifecycle, dual timelines, session revocation, MFA reset.
  * `server/routes/admin.js`, `broadcast.js`, `batches.js`, `analytics.js`, `fees.js`, `reports.js`, `student.js`, `trash.js`: Operational audit coverage.
  * `server/utils/totp.js`, `security-events.js`, `feeResolver.js`: TOTP engine, security telemetry, fee context.
* **Database, Migrations & Operational Tooling:**
  * `server/db/database.js`: SQLite configuration (WAL mode, foreign keys, 64MB cache, batch indexes).
  * `scripts/run_migrations.cjs`: Unified CLI runner with post-migration schema integrity assertions and explicit DB path support.
  * `scripts/preflight_lockdown_check.cjs`: Fail-closed writer and database handle inspection tool.
  * `scripts/production_smoke_check.cjs`: Automated fail-closed production smoke checker with strict multi-tier HTTP assertions and credential enforcement.
  * `scripts/test_production_smoke_check.cjs`: 32-vector standalone executable CLI test suite for smoke verification.
  * `server/db/migrations/20261023_super_admin.cjs`: Account promotion & schema preparation.
  * `server/db/migrations/20261023_admin_permissions.cjs`: Granular RBAC tables & default catalog.
  * `server/db/migrations/20261024_privileged_safeguards.cjs`: Sudo mode, token versions, MFA recovery codes (idempotent `{ applied: false }` return).
  * `server/db/migrations/20261024_mfa_single_use_challenges.cjs`: Server-side single-use challenge tracking (idempotent `{ applied: false }` return).
  * `server/db/migrations/20261025_admin_accountability.cjs`: Creator attribution & expanded audit ledger.
* **Frontend UI Components & Pages:**
  * `src/components/Sidebar.jsx`: Integrated Global Search, Super Admin navigation, repositioned Account Settings.
  * `src/components/GlobalSearch.jsx` & `GlobalSearch.css`: Role-aware command palette indexing Administrator Management.
  * `src/pages/admin/AdminManagement.jsx` & `AdminManagement.css`: Super Admin dashboard, dual timelines, audit ledger UI.
  * `src/pages/AdminLogin.jsx`: Multi-factor authentication flow with single-use challenge handling.
  * `src/pages/Dashboard.jsx`, `Inbox.jsx`, `Settings.jsx`, `BatchManager.jsx`: Main integration updates.
* **Automated Test Specifications:**
  * `tests/super-admin.spec.js`: 85 automated tests covering governance, MFA, accountability, and main features (including Test 85 real browser Global Search role-indexing verification).
  * `tests/course-definitions-api.spec.js`: 12 automated tests covering definition immutability and routines.
  * `tests/course-maker-e2e.spec.js`: 10 automated tests covering full lifecycle and student progress.
  * `tests/same-title-batch-collision.spec.js`: 15 automated tests covering multi-batch isolation.
  * `tests/production-smoke-check.spec.js`: 1 automated test executing the 32-vector smoke CLI specification test suite.

### 2.3 Release Distribution Boundary & Prerequisite
> [!IMPORTANT]
> **Candidate Distribution Prerequisite:** Because development, hardening, and verification were performed locally in isolated worktree `.worktrees/super-admin-integration` on branch `integration/super-admin-candidate`, the code release commit `21f3cbe7163f924f5b30c172dc1f6542c3c6f4cd` is not yet present on remote `origin`.
> 
> The production server (`bfi-classroom-server`) **cannot** fetch this revision (`git fetch origin`) until the operator reviews and pushes the candidate branch to `origin`.
> 
> **Action Required Prior to Phase 0:**
> ```bash
> # From local candidate repository:
> git push origin integration/super-admin-candidate
> # (or merge integration/super-admin-candidate into main and git push origin main)
> ```

---

## 3. Production Host Verification Summary

### 3.1 Verified Host Observations (Read-Only SSH)
* **Host Address:** `129.221.243.153` (SSH target: `ubuntu@129.221.243.153`)
* **OS & Architecture:** Ubuntu 22.04.5 LTS (`aarch64` / ARM64)
* **Runtimes:** Node.js `v22.23.4`, npm `10.9.9`, Git `2.34.1`
* **Process Manager:** PM2 `v7.1.0` running application `bfi-classroom` (ID: 0, PID: 19613) on port 3001
* **Available Disk Space:** `91 GB` available on `/` (30% utilization), sufficient for multiple database backups
* **Reverse Proxy:** Nginx active on port 80 forwarding `/bfi-classroom/` to local port 3001
* **Process Inspection Tools:** `/usr/bin/lsof` and `/usr/bin/fuser` confirmed installed with normal execution permissions
* **Database Location & Size:** `/home/ubuntu/bfi-classroom/server/bfi_classroom.db` (1.57 GB)
* **Current Production Revision:** Commit `17d933567c2b39ad2dd47d949564eee1bce2dd66` on branch `main`

### 3.2 Unverified Host Prerequisites (Marked as UNVERIFIED)
* **[UNVERIFIED] Edge Maintenance Mode Rule:** Operator must verify Cloudflare or reverse proxy maintenance page routing rules can return HTTP 503 while allowing the operator's IP to access the site.
* **[UNVERIFIED] Maintenance Window Timing:** The 45-minute scheduled maintenance window must be formally scheduled and communicated to students and instructors.
* **[UNVERIFIED] Live Super Admin Email Delivery:** Operator must confirm delivery access to `k.eye.films@gmail.com` for MFA enrollment and emergency recovery.

---

## 4. Full Automated Test Regression & Rehearsal Evidence

### 4.1 Full Regression Execution (123 / 123 Tests Passed)
All 5 test suites executed against isolated test environment:

```
================================================================================
                    BFI CLASSROOM FULL REGRESSION REPORT
================================================================================
Suite 1: Super Admin Governance, MFA & Main Feature Regression (tests/super-admin.spec.js)
  -> 85 / 85 Passed
  -> Covers: RBAC enforcement, session revocation, single-use MFA challenges,
     factor replacement lifecycle, accountability ledger coupling, broadcast retry
     atomicity, scheduled broadcast rollback, custom phase ID before-states,
     batches HTTP 304 ETag caching, batches pagination & server stats, dynamic
     unread reports count, API route guards, and real browser Global Search
     role-based indexing (Test 85).

Suite 2: Course Definitions API & Validation (tests/course-definitions-api.spec.js)
  -> 12 / 12 Passed
  -> Covers: Draft validation, phase constraints, immutability of published
     definitions, routine modifications, legacy migrations, and batch association.

Suite 3: Course Maker End-to-End Lifecycle (tests/course-maker-e2e.spec.js)
  -> 10 / 10 Passed
  -> Covers: Complete 3-phase lifecycle, practical classes, assignment grading,
     exam results, certificates issuance, and multi-batch isolation.

Suite 4: Same-Title Batch Collision & Multi-Batch Registry (tests/same-title-batch-collision.spec.js)
  -> 15 / 15 Passed
  -> Covers: Identical course title isolation, batch fee overrides, course settings
     isolation, student portal separation, and instructor scope filtering.

Suite 5: Production Smoke Check CLI Specification (tests/production-smoke-check.spec.js)
  -> 1 / 1 Passed (executing 32 discrete requirement vectors in scripts/test_production_smoke_check.cjs)

--------------------------------------------------------------------------------
TOTAL REGRESSION VERDICT: 123 / 123 TESTS PASSED (100% PASS RATE)
LINT VERDICT: 0 ERRORS (168 warnings)
BUILD VERDICT: VITE PRODUCTION BUILD PASSED (dist/index.html & dist/404.html in 1.07s)
ROOT DATABASE INTEGRITY: SHA-256 BF37A89C3F0DA1038E2E9A8FA18916D9A2986541A062C9AB40EE51E4987F5F1E (UNMODIFIED)
================================================================================
```

### 4.2 Migration Distinction Rehearsal Evidence
The distinction between an initial migration from a true pre-upgrade database and repeat execution (idempotency) was verified on disposable replicas:

* **Scenario A: Initial Migration from True Pre-Upgrade Database:**
  * Rehearsed against a clean pre-upgrade replica (`users.is_super_admin = 0`, 0 migrations in `app_migrations`, zero admin permission tables).
  * Executed `run_migrations.cjs`:
    * `20261023_super_admin`: Verified User 1 (`admin@abir` / `k.eye.films@gmail.com`) and promoted to Super Admin (`is_super_admin = 1`).
    * `20261023_admin_permissions`: Created permissions tables, seeded 36 operational permissions for ordinary admins (`admin2` id=7, `admin@test` id=570).
    * `20261024_privileged_safeguards`: Applied user token/permissions versioning, session activity tracking, and recovery codes table.
    * `20261024_mfa_single_use_challenges`: Applied challenge tracking table.
    * `20261025_admin_accountability`: Applied `created_by_admin_id` and expanded operational audit columns.
  * Verified 10/10 schema assertions: 5 migrations recorded, 0 foreign key violations, PRAGMA `quick_check` = ok.
* **Scenario B: Repeat Execution (Idempotency) on Already-Upgraded Database:**
  * Executed `run_migrations.cjs` immediately a second time against the upgraded database.
  * Result: Exactly 5/5 migrations returned `{ applied: false, reason: 'Already applied' }` and logged `ℹ️ [Skipped] Already applied`.
  * Verified: 0 duplicated permissions (ordinary admin permissions remained exactly 36), 0 duplicated migration rows (remained exactly 5), schema integrity verified, exit code `0`.

### 4.3 Automated Smoke Check CLI Test Suite Evidence (32 Vectors)
Executed `node scripts/test_production_smoke_check.cjs` with 32 passed assertions across 9 core test categories:
1. **Neither Credential Supplied:** Exits with code 1; reports fatal missing credentials; rejects deployment gate.
2. **Only Super Admin Credential Supplied:** Exits with code 1; identifies Ordinary Admin token as missing.
3. **Only Ordinary Admin Credential Supplied:** Exits with code 1; identifies Super Admin token as missing.
4. **Whitespace-Only Credentials:** Exits with code 1; identifies credentials as missing/empty.
5. **Both Credentials Supplied:** Exits with code 0; verifies all 5 tiers (Tier 1.1–1.3, Tier 2.1–2.3, Tier 3.1–3.6, Tier 4a.1–4a.3, Tier 4b.1–4b.3); clears deployment gate.
6. **Credential Confidentiality:** Secret token strings are NEVER printed in stdout or stderr under any condition.
7. **Partial Diagnostics Mode (`--diagnostics`):** Runs unauthenticated tiers for troubleshooting; exits 0 without clearing deployment gate; explicitly outputs `DOES NOT authorize deployment`.
8. **Protected Endpoint Unexpected Status (RBAC Leak):** Endpoint returning 200 instead of 403 exits with code 1 and logs status mismatch assertion.
9. **Protected Endpoint Malformed JSON:** Endpoint returning HTML instead of JSON exits with code 1 and logs parse failure.
10. **Connection Failure (ECONNREFUSED):** Handled gracefully with code 1.
11. **Request Timeout:** Handled gracefully with code 1 on exceeding timeout threshold.

---

## 5. Hardened Executable Production Deployment Runbook

Execute this exact runbook sequentially during the approved maintenance window. Every command is fail-closed (`set -e`). If any step fails, execution halts immediately.

### Phase 0: Pre-Flight Staging & Safety Gate Preparation
Before stopping any production services, stage the reviewed operational scripts and preserve recovery tooling.

```bash
set -e
cd /home/ubuntu/bfi-classroom

# 1. Fetch release candidate commit from origin (prerequisite: operator pushed candidate to origin)
git fetch origin

# 2. Stage the candidate release containing all operational and recovery tooling
git checkout 854dd0a21f156e481e17622c7e0fa7707cefdded

# 3. Verify script presence and file integrity without executing operational checks
test -s scripts/production_lifecycle.cjs
test -s scripts/verify_isolation.cjs
test -s scripts/preflight_lockdown_check.cjs
test -s scripts/run_migrations.cjs
test -s scripts/production_smoke_check.cjs

# 4. Canonical Deployment Execution:
# Run full automated deployment lifecycle (Phases 0 through 6) with fail-closed gates:
# SUPER_ADMIN_TOKEN="$SA_TOKEN" ADMIN_TOKEN="$ORD_TOKEN" node scripts/production_lifecycle.cjs deploy
```

### Phase 1: Maintenance Mode & Complete Origin Isolation
1. **Engage Edge Maintenance Mode:**
   * Enable 503 Maintenance Mode on Cloudflare / edge proxy for public traffic (`/bfi-classroom/*`).
2. **Stop Ingress Reverse Proxy (Direct Origin IP Protection):**
   ```bash
   sudo systemctl stop nginx
   ```
3. **Stop Application Backend Writer:**
   ```bash
   pm2 stop bfi-classroom
   ```
4. **Execute Fail-Closed Isolation Verification:**
   ```bash
   node scripts/verify_isolation.cjs
   ```
   *Gate:* Must confirm Nginx inactive, 0 Nginx processes, 0 listening sockets on 80/443, 0 established connections, PM2 application stopped, port 3001 closed. Exit code 0 required.
5. **Execute Fail-Closed Database Handle Verification:**
   ```bash
   node scripts/preflight_lockdown_check.cjs
   ```
   *Gate:* Must output `VERDICT: MAINTENANCE GATE OPEN` with exit code `0` (0 active handles via `lsof`/`fuser`, WAL truncated, quick_check ok). If this exits nonzero, **HALT DEPLOYMENT IMMEDIATELY**.

### Phase 2: Dynamic Pre-Deployment Health Check & Backup Validation
1. **Capture Deployed Revision for Rollback:**
   ```bash
   git rev-parse HEAD > server/pre_deployment_revision.txt
   echo "Pre-deployment revision recorded: $(cat server/pre_deployment_revision.txt)"
   ```
2. **Dynamically Capture Pre-Deployment Baseline:**
   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const fs = require('fs');
   const db = new Database('server/bfi_classroom.db', { readonly: true });
   
   const quickCheck = db.prepare('PRAGMA quick_check').get();
   const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
   if (quickCheck.quick_check !== 'ok' || fkCheck.length > 0) {
     console.error('FATAL: Database failed pre-flight health check!', quickCheck, fkCheck);
     process.exit(1);
   }

   const baseline = {
     student_course_enrollments: db.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c,
     users: db.prepare('SELECT count(*) as c FROM users').get().c,
     batches: db.prepare('SELECT count(*) as c FROM batches').get().c,
     batch_course_fees: db.prepare('SELECT count(*) as c FROM batch_course_fees').get().c,
     timestamp: new Date().toISOString()
   };
   fs.writeFileSync('server/pre_deployment_baseline.json', JSON.stringify(baseline, null, 2));
   console.log('Pre-deployment baseline captured dynamically:', baseline);
   db.close();
   "
   ```
3. **Create Pre-Deployment Backup:**
   ```bash
   BACKUP_TS=$(date +%Y%m%d_%H%M%S)
   BACKUP_FILE="server/bfi_classroom_preflight_${BACKUP_TS}.db"
   echo "BACKUP_FILE=${BACKUP_FILE}" > server/active_backup_path.env

   node -e "
   const Database = require('better-sqlite3');
   const src = new Database('server/bfi_classroom.db', { readonly: true });
   src.backup('${BACKUP_FILE}').then(() => {
     console.log('Online backup created successfully: ${BACKUP_FILE}');
     src.close();
   });
   "
   ```
4. **Validate Backup File & Rehearse Disposable Restore:**
   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const fs = require('fs');
   const baseline = JSON.parse(fs.readFileSync('server/pre_deployment_baseline.json'));
   const backupPath = '${BACKUP_FILE}';
   
   // 1. Health check on backup file
   const bDb = new Database(backupPath, { readonly: true });
   const qCheck = bDb.prepare('PRAGMA quick_check').get();
   const bEnrollments = bDb.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c;
   const bFk = bDb.prepare('PRAGMA foreign_key_check').all();
   bDb.close();
   
   if (qCheck.quick_check !== 'ok' || bFk.length > 0 || bEnrollments !== baseline.student_course_enrollments) {
     console.error('FATAL: Backup file validation failed!', qCheck, bFk, bEnrollments);
     process.exit(1);
   }

   // 2. Rehearse restore to scratch file
   fs.copyFileSync(backupPath, 'server/restore_test.db');
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
1. **Checkout Pinned Release Candidate Commit:**
   ```bash
   git checkout 854dd0a21f156e481e17622c7e0fa7707cefdded
   ```
2. **Install Dependencies (Including DevDependencies for Vite):**
   ```bash
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
1. **Run Unified Migration Runner:**
   ```bash
   node scripts/run_migrations.cjs server/bfi_classroom.db
   ```
   *Gate:* Must execute all 5 migrations in chronological order, verify all 10 schema integrity assertions, and exit with code `0`. If this command fails, halt and trigger Rollback Runbook (Window A).

### Phase 5: Start Service & Automated Production Smoke Checks (Under Isolation)
1. **Verify Nginx is STILL Stopped:**
   ```bash
   node scripts/verify_isolation.cjs
   ```
2. **Start PM2 Backend Locally (127.0.0.1:3001):**
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 status
   ```
3. **Verify PM2 is Online While Nginx Remains Inactive:**
   ```bash
   node scripts/verify_isolation.cjs --allow-pm2
   ```
4. **Execute Automated Fail-Closed Smoke Check Over Loopback:**
   Pass tokens securely via protected environment variables:
   ```bash
   SUPER_ADMIN_TOKEN="$SA_TOKEN" ADMIN_TOKEN="$ORD_TOKEN" node scripts/production_smoke_check.cjs http://127.0.0.1:3001
   ```
   *Gate:* If `production_smoke_check.cjs` exits with code `1`, **DO NOT REOPEN TRAFFIC**. Trigger Rollback Runbook (Window A).

### Phase 6: Traffic Reopening Decision Point
1. **Set Conservative Exposure Boundary (Pre-Command Atomic Persistence):**
   * Persist `trafficMayReopen: true` and `trafficExposureInitiatedAt: <ISO timestamp>` atomically to `server/active_deployment_state.json` **before** executing any exposure command.
   * *Safety Guarantee:* If starting Nginx or the subsequent status inspection times out, crashes, or fails, automatic stale-backup restoration is permanently locked out to prevent silent overwriting of new user writes.
2. **Restore Nginx Ingress Service:**
   ```bash
   sudo systemctl start nginx
   sudo systemctl is-active nginx
   ```
3. **Persist Final Reopening State:**
   * Atomically persist `trafficReopened: true` and `trafficReopenedAt: <ISO timestamp>` to `server/active_deployment_state.json`.
4. **Remove Edge 503 Maintenance Mode:**
   * Disable Cloudflare / reverse proxy maintenance mode.
5. **Monitor PM2 Logs for 15 Minutes:**
   ```bash
   pm2 logs bfi-classroom --lines 100
   ```

---

## 6. Hardened Production Rollback Runbook & Safety Limits

### 6.1 Rollback Decision Points & Data Loss Policy
* **Window A: Maintenance Window (Pre-Traffic Exposure):**
  * If migrations fail, the build fails, or smoke tests fail *before* public traffic is reopened, executing the rollback procedure causes **zero data loss**, because public traffic remained blocked by maintenance mode.
* **Window B: Live Production (Post-Traffic Exposure & Post-Rollback Replay Protection):**
  * **CRITICAL POLICY:** Once public traffic exposure begins (`trafficMayReopen: true` or `trafficReopened: true`), restoring a pre-deployment database backup will overwrite and permanently destroy any new user transactions created between traffic reopening and the rollback decision (including student quiz submissions, enrollments, fees recorded, attendance logs, and community messages).
  * **Terminal Rollback & Replay Protection:**
    * When rollback completes and restores Nginx, exposure flags (`trafficMayReopen`, `trafficReopened`) are **never cleared**.
    * The rollback attempt is recorded as terminal (`rollbackCompleted: true`, `rolledBackAt: <ISO timestamp>`).
    * Reusing a completed rollback's backup for a second automatic restoration is **strictly rejected in Phase R.1 before touching database files**, protecting any writes made after rollback reopened traffic.
    * Retained forensic markers (`active_backup_path.env`) record rollback completion timestamps for forensic audit without granting authorization for automatic restoration.
  * **Fail-Closed Metadata Gates:**
    * Rollback strictly requires a valid `server/active_deployment_state.json` file.
    * Missing file, malformed JSON, missing `attemptId`, non-boolean boundary or rollback flags, or mismatch with `server/active_backup_path.env` immediately throws a fatal error and halts without touching database files.
    * Legacy marker files (`active_backup_path.env`) can NEVER bypass state validation.
  * **Mandatory Rule:** Restoring a stale backup after public traffic has been exposed or after a prior rollback has completed is **strictly blocked by the rollback engine unless explicitly overridden with `--allow-post-reopening-reconciliation` following an approved data reconciliation plan**.
  * If a defect is identified after reopening traffic:
    1. Immediately engage 503 maintenance mode (`sudo systemctl stop nginx` & `pm2 stop bfi-classroom`).
    2. Take a forensic snapshot of the live database (`server/bfi_classroom.db`) and WAL file (`server/bfi_classroom.db-wal`).
    3. Formulate a custom data reconciliation plan (e.g. selectively dumping rows with `created_at > <trafficExposureInitiatedAt>` across affected tables).
    4. Obtain explicit written sign-off from the system operator before executing any database restore.

### 6.2 Automated Canonical Rollback Runner (Window A - Maintenance Window)
The quickest and safest recovery method is executing the canonical rollback runner, which automates the exact fail-closed sequence and halts safely if any step fails:

```bash
# Run canonical rollback from working tree:
node scripts/production_lifecycle.cjs rollback

# If git checkout or working tree state removed scripts/, run from preserved recovery tooling:
node server/.recovery_tools/production_lifecycle.cjs rollback

# If post-reopening forensic restoration is explicitly authorized by operator:
node scripts/production_lifecycle.cjs rollback --allow-post-reopening-reconciliation
```

### 6.3 Step-by-Step Manual Rollback Runbook (Window A - Maintenance Window)
Strict fail-closed manual execution (`set -e`, zero `|| true`):

```bash
set -e
cd /home/ubuntu/bfi-classroom

# 1. Stop backend application immediately
pm2 stop bfi-classroom

# 2. Ensure Nginx remains stopped throughout rollback
sudo systemctl stop nginx

# 3. Enforce fail-closed writer lockdown check (confirm zero writers before touching files)
node scripts/preflight_lockdown_check.cjs || node server/.recovery_tools/preflight_lockdown_check.cjs

# 4. Check active deployment state: Ensure traffic was not reopened
node -e "
const fs = require('fs');
if (fs.existsSync('server/active_deployment_state.json')) {
  const st = JSON.parse(fs.readFileSync('server/active_deployment_state.json'));
  if (st.trafficReopened === true && !process.env.ALLOW_POST_REOPENING_RECONCILIATION) {
    console.error('FATAL: Automatic restore rejected! Traffic was reopened at ' + st.trafficReopenedAt);
    process.exit(1);
  }
}
"

# 5. Preserve failed database, WAL, and SHM sidecars together (Forensic Quarantine without deletion)
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
echo "Failed database state and sidecars quarantined for forensic inspection."

# 6. Restore validated pre-deployment backup
source server/active_backup_path.env
cp "${BACKUP_FILE}" server/bfi_classroom.db

# 7. Verify restored database integrity and baseline invariants
node -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const baseline = JSON.parse(fs.readFileSync('server/pre_deployment_baseline.json'));

const db = new Database('server/bfi_classroom.db', { readonly: true });
const quickCheck = db.prepare('PRAGMA quick_check').get();
const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
const restoredEnrollments = db.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c;
const restoredUsers = db.prepare('SELECT count(*) as c FROM users').get().c;
const restoredBatches = db.prepare('SELECT count(*) as c FROM batches').get().c;
const restoredFees = db.prepare('SELECT count(*) as c FROM batch_course_fees').get().c;
db.close();

if (quickCheck.quick_check !== 'ok' || fkCheck.length > 0) {
  console.error('FATAL: Restored database integrity check failed!');
  process.exit(1);
}
if (restoredEnrollments !== baseline.student_course_enrollments ||
    restoredUsers !== baseline.users ||
    restoredBatches !== baseline.batches ||
    restoredFees !== baseline.batch_course_fees) {
  console.error('FATAL: Baseline invariant mismatch after restore!');
  process.exit(1);
}
console.log('✅ Restored database verified: quick_check ok, 0 FK violations, exact baseline match.');
"

# 8. Restore previous code revision and rebuild runtime assets
PREV_REV=$(cat server/pre_deployment_revision.txt)
echo "Restoring code revision: ${PREV_REV}"
git checkout "${PREV_REV}"
NODE_ENV=development npm ci --legacy-peer-deps
npm run build
npm prune --omit=dev --legacy-peer-deps

# 9. Restart application on restored revision
pm2 start ecosystem.config.cjs
pm2 status

# 10. Verify service restored over loopback
curl -f -I -s http://127.0.0.1:3001/bfi-classroom/ | grep "200"

# 11. Restore Nginx service state if originally active
sudo systemctl start nginx
sudo systemctl is-active nginx

echo "✅ Rollback completed successfully. Pre-maintenance state restored."

```
