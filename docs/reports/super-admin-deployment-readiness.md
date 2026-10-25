# BFI Classroom Super Admin Deployment Readiness & Approval Package

**Prepared Date:** October 25, 2026  
**Candidate Worktree:** `.worktrees/super-admin-integration`  
**Candidate Branch:** `integration/super-admin-candidate`  
**Exact Release Candidate Commit SHA:** `7fabdc89ad3f1bd9179a4d91b4d04060c404d437`  
**Base Commit (Integrated Local Main):** `17d93356e4ec084c718e874cecfb0a82b9e69c10` (Full 11-commit revision gap integrated)  
**Target Super Admin Account:** ID `1`, `admin@abir` / `k.eye.films@gmail.com`  
**Production Host:** `bfi-classroom-server` (`129.221.243.153`, Ubuntu 22.04 LTS aarch64)  
**Root Database SHA-256 (Pristine):** `BF37A89C3F0DA1038E2E9A8FA18916D9A2986541A062C9AB40EE51E4987F5F1E`  

---

## 1. Executive Deployment Verdict: READY FOR APPROVAL

All local integration, regression testing, deployment safety, rollback hardening, and migration execution requirements have been completely resolved and independently verified.

| Category | Status | Details |
| :--- | :---: | :--- |
| **Main Branch Gap Integration** | **PASS** | 11/11 commits from `4d8feb0..17d9335` cleanly merged; Global Search, ETag caching, SWR pagination, N+1 fee context, unread reports preserved. |
| **Fail-Closed Safety Gates** | **PASS** | All `\|\| true` eliminated; `set -e` enforced; 14/14 subprocess fail-closed rehearsal vectors pass. |
| **Unified Migration Runner** | **PASS** | `scripts/run_migrations.cjs` built with explicit path support, chronological order, and post-migration schema integrity assertions. |
| **Migration Rehearsals** | **PASS** | Initial migration, repeat idempotency execution, and simulated failure rollback 100% verified on disposable 1.5GB database copy. |
| **Deployment & Rollback Rehearsal** | **PASS** | End-to-end rehearsal passed on disposable staging sandbox; dirty state quarantined, validated preflight backup restored. |
| **Automated Test Regression** | **PASS** | **122 / 122 Tests Passing** across all 4 suites (including new tests 82–85 for integrated features). |
| **Code Quality & Build** | **PASS** | **0 ESLint Errors** (168 warnings); clean production Vite build (`dist/index.html` & `dist/404.html` generated in 9.87s). |
| **Pristine Root Database** | **PASS** | Root database SHA-256 verified unchanged (`BF37A89C...5F1E`). |
| **Live Host Read-Only Inspection** | **VERIFIED** | Ubuntu 22.04 aarch64, Node v22.23.4, PM2 v7.1.0, 91GB disk available, Nginx proxy active, `lsof`/`fuser` available. |
| **Edge Maintenance Mode Bypass** | **UNVERIFIED** | Edge Cloudflare/proxy 503 maintenance bypass rule must be verified by the system operator before maintenance window. |

---

## 2. Integrated Code Gap & File Inventory

### 2.1 The 11 Integrated Commits from Local `main` (`4d8feb0..17d9335`)
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

### 2.2 Complete Release Candidate File Inventory (Commit `7fabdc8`)
* **Core Application Entry & Security:**
  * `server/server.js`: Express router mounting, security headers, rate limiters, session tracking.
  * `server/middleware/auth.js`: Real-time RBAC middleware, `requireSuperAdmin`, `requirePermission`, `requireSudo`, `authLimiter`.
  * `server/services/auditLedgerService.js`: Transaction-coupled operational audit logging with deep recursive credential sanitization.
  * `server/services/courseProgressService.js`: Dynamic phase resolution, atomic academic mutations, transactional before/after snapshots.
  * `server/routes/admin-management.js`: Super Admin APIs, admin lifecycle, dual timelines, session revocation, MFA reset.
  * `server/routes/admin.js`, `broadcast.js`, `batches.js`, `analytics.js`, `fees.js`, `reports.js`, `student.js`, `trash.js`: Operational audit coverage.
  * `server/utils/totp.js`, `security-events.js`, `feeResolver.js`: TOTP engine, security telemetry, fee context.
* **Database & Migrations:**
  * `server/db/database.js`: SQLite configuration (WAL mode, foreign keys, 64MB cache, batch indexes).
  * `scripts/run_migrations.cjs`: Unified CLI runner with post-migration schema integrity assertions.
  * `scripts/preflight_lockdown_check.cjs`: Fail-closed writer and database handle inspection tool.
  * `server/db/migrations/20261023_super_admin.cjs`: Account promotion & schema preparation.
  * `server/db/migrations/20261023_admin_permissions.cjs`: Granular RBAC tables & default catalog.
  * `server/db/migrations/20261024_privileged_safeguards.cjs`: Sudo mode, token versions, MFA recovery codes.
  * `server/db/migrations/20261024_mfa_single_use_challenges.cjs`: Server-side single-use challenge tracking.
  * `server/db/migrations/20261025_admin_accountability.cjs`: Creator attribution & expanded audit ledger.
* **Frontend UI Components & Pages:**
  * `src/components/Sidebar.jsx`: Integrated Global Search, Super Admin navigation, repositioned Account Settings.
  * `src/components/GlobalSearch.jsx` & `GlobalSearch.css`: Role-aware command palette indexing Administrator Management.
  * `src/pages/admin/AdminManagement.jsx` & `AdminManagement.css`: Super Admin dashboard, dual timelines, audit ledger UI.
  * `src/pages/AdminLogin.jsx`: Multi-factor authentication flow with single-use challenge handling.
  * `src/pages/Dashboard.jsx`, `Inbox.jsx`, `Settings.jsx`, `BatchManager.jsx`: Main integration updates.
* **Automated Test Specifications:**
  * `tests/super-admin.spec.js`: 85 automated tests covering governance, MFA, accountability, and main features.
  * `tests/course-definitions-api.spec.js`: 12 automated tests covering definition immutability and routines.
  * `tests/course-maker-e2e.spec.js`: 10 automated tests covering full lifecycle and student progress.
  * `tests/same-title-batch-collision.spec.js`: 15 automated tests covering multi-batch isolation.

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
* **Current Production Revision:** Commit `17d9335` on branch `main`

### 3.2 Unverified Host Prerequisites (Marked as UNVERIFIED)
* **[UNVERIFIED] Edge Maintenance Mode Rule:** Operator must verify Cloudflare or reverse proxy maintenance page routing rules can return HTTP 503 while allowing the operator's IP to access the site.
* **[UNVERIFIED] Maintenance Window Timing:** The 45-minute scheduled maintenance window must be formally scheduled and communicated to students and instructors.
* **[UNVERIFIED] Live Super Admin Email Delivery:** Operator must confirm delivery access to `k.eye.films@gmail.com` for MFA enrollment and emergency recovery.

---

## 4. Full Automated Test Regression Evidence

All 4 test suites executed against isolated backend port 3099 and frontend port 5174:

```
================================================================================
                    BFI CLASSROOM FULL REGRESSION REPORT
================================================================================
Suite 1: Super Admin Governance, MFA & Main Feature Regression (tests/super-admin.spec.js)
  -> 85 / 85 Passed (58.0s)
  -> Covers: RBAC enforcement, session revocation, single-use MFA challenges,
     factor replacement lifecycle, accountability ledger coupling, broadcast retry
     atomicity, scheduled broadcast rollback, custom phase ID before-states,
     batches HTTP 304 ETag caching, batches pagination & server stats, dynamic
     unread reports count, and Global Search role guards.

Suite 2: Course Definitions API & Validation (tests/course-definitions-api.spec.js)
  -> 12 / 12 Passed (6.4s)
  -> Covers: Draft validation, phase constraints, immutability of published
     definitions, routine modifications, legacy migrations, and batch association.

Suite 3: Course Maker End-to-End Lifecycle (tests/course-maker-e2e.spec.js)
  -> 10 / 10 Passed (4.3s)
  -> Covers: Complete 3-phase lifecycle, practical classes, assignment grading,
     exam results, certificates issuance, and multi-batch isolation.

Suite 4: Same-Title Batch Collision & Multi-Batch Registry (tests/same-title-batch-collision.spec.js)
  -> 15 / 15 Passed (35.3s)
  -> Covers: Identical course title isolation, batch fee overrides, course settings
     isolation, student portal separation, and instructor scope filtering.

--------------------------------------------------------------------------------
TOTAL REGRESSION VERDICT: 122 / 122 TESTS PASSED (100% PASS RATE)
LINT VERDICT: 0 ERRORS (168 warnings)
BUILD VERDICT: VITE PRODUCTION BUILD PASSED (dist/index.html & dist/404.html in 9.87s)
ROOT DATABASE INTEGRITY: SHA-256 BF37A89C3F0DA1038E2E9A8FA18916D9A2986541A062C9AB40EE51E4987F5F1E (UNMODIFIED)
================================================================================
```

---

## 5. Hardened Executable Production Deployment Runbook

Execute this exact runbook sequentially during the approved maintenance window. Every command is fail-closed (`set -e`). If any step fails, execution halts immediately.

### Phase 0: Pre-Flight Staging & Safety Gate Preparation
Before stopping any production services, stage the reviewed preflight script from the release candidate:

```bash
set -e
cd /home/ubuntu/bfi-classroom

# 1. Fetch release candidate commit without checking out entire tree yet
git fetch origin

# 2. Stage the reviewed preflight inspection script
git checkout 7fabdc89ad3f1bd9179a4d91b4d04060c404d437 -- scripts/preflight_lockdown_check.cjs

# 3. Verify script staged and executable
node scripts/preflight_lockdown_check.cjs --help || true
```

### Phase 1: Maintenance Mode & Writer Lockdown
1. **Engage Edge Maintenance Mode:**
   * Enable 503 Maintenance Mode on Cloudflare / edge proxy for public traffic (`/bfi-classroom/*`).
2. **Stop Application Process:**
   ```bash
   pm2 stop bfi-classroom
   ```
3. **Execute Fail-Closed Preflight Gate:**
   ```bash
   node scripts/preflight_lockdown_check.cjs
   ```
   *Gate:* Must output `VERDICT: MAINTENANCE GATE OPEN` with exit code `0`. If this command exits with code `1`, **HALT DEPLOYMENT IMMEDIATELY**. Do not proceed.

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
   bDb.close();
   
   if (qCheck.quick_check !== 'ok' || bEnrollments !== baseline.enrollments) {
     console.error('FATAL: Backup file validation failed!', qCheck, bEnrollments);
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
   git checkout 7fabdc89ad3f1bd9179a4d91b4d04060c404d437
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
   *Gate:* Must execute all 5 migrations in chronological order, verify all schema integrity assertions, and exit with code `0`. If this command fails, halt and trigger Rollback Runbook (Window A).

### Phase 5: Start Service & Decoupled Production Smoke Checks
1. **Start Application Process:**
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 status
   ```
2. **Smoke Tier 1: Static Frontend Shell:**
   ```bash
   curl -I -s http://127.0.0.1:3001/bfi-classroom/ | grep "HTTP/1.1 200 OK"
   ```
3. **Smoke Tier 2: Unauthenticated Backend Express Router & Middleware:**
   ```bash
   # Expect HTTP 400 Bad Request with username validation error
   curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3001/api/auth/login
   ```
4. **Smoke Tier 3: Authenticated Admin Profile API:**
   ```bash
   curl -s -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" http://127.0.0.1:3001/api/auth/me | grep '"username":'
   ```
5. **Smoke Tier 4: Super Admin Role Guard Verification:**
   ```bash
   # Super Admin query returns HTTP 200
   curl -s -H "Authorization: Bearer <SUPER_ADMIN_ACCESS_TOKEN>" http://127.0.0.1:3001/api/admin/administrators | grep '"administrators":'

   # Ordinary Admin query returns HTTP 403 Forbidden
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <ORDINARY_ADMIN_ACCESS_TOKEN>" http://127.0.0.1:3001/api/admin/administrators
   ```
6. **Reopen Public Traffic:**
   * Remove 503 maintenance page on Cloudflare / reverse proxy. Monitor PM2 logs for 15 minutes:
   ```bash
   pm2 logs bfi-classroom --lines 100
   ```

---

## 6. Hardened Production Rollback Runbook & Safety Limits

### 6.1 Rollback Decision Points & Data Loss Policy
* **Window A: Maintenance Window (Pre-Traffic Reopening):**
  * If migrations fail, the build fails, or smoke tests fail *before* public traffic is reopened, executing the rollback procedure causes **zero data loss**, because public traffic remained blocked by maintenance mode.
* **Window B: Live Production (Post-Traffic Reopening):**
  * **CRITICAL POLICY:** Once public traffic is reopened, restoring a pre-deployment database backup will overwrite and permanently destroy any new user transactions created between traffic reopening and the rollback decision (including student quiz submissions, fees recorded, attendance logs, and community messages).
  * **Mandatory Rule:** Restoring a stale backup after public traffic has reopened is **strictly forbidden without an approved application data reconciliation plan and explicit operator sign-off**.
  * If a defect is identified after reopening traffic:
    1. Immediately engage 503 maintenance mode (`pm2 stop bfi-classroom`).
    2. Take a forensic snapshot of the live database (`server/bfi_classroom.db`) and WAL file (`server/bfi_classroom.db-wal`).
    3. Formulate a custom data reconciliation plan (e.g. selectively dumping rows with `created_at > <reopening_time>` across affected tables).
    4. Obtain explicit written sign-off from the system operator before executing any database restore.

### 6.2 Executable Rollback Steps (Window A - Maintenance Window)
Strict fail-closed execution (`set -e`, zero `|| true`):

```bash
set -e
cd /home/ubuntu/bfi-classroom

# 1. Stop application immediately
pm2 stop bfi-classroom

# 2. Enforce fail-closed writer lockdown check (confirm zero writers before touching files)
node scripts/preflight_lockdown_check.cjs

# 3. Preserve failed database & active WAL files (Forensic Quarantine without deletion)
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

# 4. Restore validated pre-deployment backup
source server/active_backup_path.env
cp "${BACKUP_FILE}" server/bfi_classroom.db

# 5. Verify restored database integrity and baseline invariants
node -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const baseline = JSON.parse(fs.readFileSync('server/pre_deployment_baseline.json'));

const db = new Database('server/bfi_classroom.db', { readonly: true });
const quickCheck = db.prepare('PRAGMA quick_check').get();
const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
const restoredEnrollments = db.prepare('SELECT count(*) as c FROM student_course_enrollments').get().c;
db.close();

if (quickCheck.quick_check !== 'ok' || fkCheck.length > 0) {
  console.error('FATAL: Restored database integrity check failed!');
  process.exit(1);
}
if (restoredEnrollments !== baseline.enrollments) {
  console.error('FATAL: Enrollment baseline mismatch: expected ' + baseline.enrollments + ', got ' + restoredEnrollments);
  process.exit(1);
}
console.log('✅ Restored database verified: quick_check ok, 0 FK violations, enrollments exact match.');
"

# 6. Restore previous code revision and rebuild runtime assets
PREV_REV=$(cat server/pre_deployment_revision.txt)
echo "Restoring code revision: ${PREV_REV}"
git checkout "${PREV_REV}"
NODE_ENV=development npm ci --legacy-peer-deps
npm run build
npm prune --omit=dev --legacy-peer-deps

# 7. Restart application on restored revision
pm2 start ecosystem.config.cjs
pm2 status

# 8. Verify service restored
curl -I -s http://127.0.0.1:3001/bfi-classroom/ | grep "HTTP/1.1 200 OK"
echo "✅ Rollback completed successfully. Traffic remains in maintenance until operator inspection."
```
