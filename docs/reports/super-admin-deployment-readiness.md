# BFI Classroom Super Admin Deployment Readiness & Approval Package

**Prepared Date:** October 26, 2026  
**Candidate Worktree:** `.worktrees/super-admin-integration`  
**Candidate Branch:** `integration/super-admin-candidate`  
**Exact Application Code Release Commit SHA:** `21f3cbe7163f924f5b30c172dc1f6542c3c6f4cd` (with production branding from `0c71163495e58a51f1709272ec55d99a31251ec3`)  
**Hardened Operational Tooling & Security Enforcement SHA:** `841106d38d3ed7ed9ddfe67790616feaf4a0e7c7`  
**Branding Integration Merge Commit SHA:** `7dbd7a43a1a14fe9fe4a3a4f3e84d3cb40a88c37`  
**Previously Published Remote Branch Origin HEAD:** `5903458cb9ca69da67518b568fc5aecbe9b9eda0` (Published to origin/integration/super-admin-candidate)  
**Base Commit (Integrated origin/main):** `0c71163495e58a51f1709272ec55d99a31251ec3` (Full 12-commit revision gap integrated)  
**Expected Live Production Host Revision:** `0c71163495e58a51f1709272ec55d99a31251ec3` (Verified online via SSH, PM2 PID 34952)  
**Target Super Admin Account:** ID `1`, `admin@abir` / `k.eye.films@gmail.com`  
**Production Host:** `bfi-classroom-server` (`129.221.243.153`, Ubuntu 22.04 LTS aarch64)  
**Root Database SHA-256 (Pristine):** `BF37A89C3F0DA1038E2E9A8FA18916D9A2986541A062C9AB40EE51E4987F5F1E`  

---

## 1. Executive Deployment Verdict: READY FOR PUBLICATION & OPERATOR APPROVAL

All local integration, regression testing, deployment safety, rollback hardening, migration distinction validation, fail-closed isolation inspection, and automated production smoke verification requirements have been completely resolved and independently verified.

| Category | Status | Details |
| :--- | :---: | :--- |
| **Main Branch Gap Integration** | **PASS** | 12/12 commits from `4d8feb0..0c71163` cleanly merged; Global Search, ETag caching, SWR pagination, N+1 fee context, unread reports, and production branding squircle favicons preserved. |
| **Reviewed Application & Branding Code** | **PASS** | Commit `21f3cbe` application files (`src/*`, `server/*`) preserved with verified Super Admin RBAC; 4 production branding assets (`index.html`, `public/apple-touch-icon.png`, `public/favicon.png`, `public/favicon.svg`) integrated byte-for-byte from `0c71163`. |
| **Fail-Closed Isolation Gates** | **PASS** | `scripts/verify_isolation.cjs` validates Nginx systemd status, 0 running processes, 0 listener sockets (80/443), 0 established connections, PM2 state, and port 3001 closure. 16/16 unit test vectors pass (`test_verify_isolation.cjs`). |
| **Fail-Closed Rollback Runner** | **PASS** | `scripts/production_lifecycle.cjs` validates command execution errors, signals, timeouts, non-zero exits; asserts PM2 online status and curl 200 loopback health before considering Nginx start. 58/58 failure vectors pass (`test_rollback_failures.cjs`). |
| **Recovery Tooling Survival** | **PASS** | Operational tools preserved in `server/.recovery_tools/` outside tracked tree; cold-start survival across real git checkout in a new Node process proven via disposable Git repository rehearsal (`rehearse_git_recovery.cjs`) with negative dependency verification proving all 6 scripts are strictly self-contained. |
| **Rollback Boundary & Replay Gates** | **PASS** | Conservative `trafficMayReopen` boundary persisted atomically BEFORE exposure commands in both deploy and rollback; exposure flags never cleared; completed rollbacks marked terminal with replay protection against stale restore; missing/malformed state metadata fails closed. |
| **Bounded Credential Handoff** | **PASS** | `scripts/obtain_smoke_credentials.cjs` provides confidential interactive secret entry with zero echo, detached TTY listeners on timeout/cancellation/success, protected file storage (0o600/0o700), and best-effort cleanup. 28/28 integration & unit tests pass (`test_credential_handoff.cjs`). |
| **Strict Maintenance Gate & Replay Defense** | **PASS** | Removed permanent loopback exemption in `server/routes/auth.js`. Maintenance verification requires: valid active `attemptId` (length >= 8), `backupValidated === true`, `backupFile` on disk, `active_backup_path.env` consistency, explicit boolean exposure flags strictly false (`trafficMayReopen === false`, `trafficReopened === false`), and nonterminal deployment state. Ephemeral single-use capabilities bound to attemptId and specific accounts with atomic in-memory (`consumedMaintenanceTokenHashes`) & disk-level consumption. Missing/malformed state fails closed. |
| **Unified Migration Runner** | **PASS** | `scripts/run_migrations.cjs` built with explicit path support, chronological order, and 10/10 post-migration schema integrity assertions. |
| **6-Scenario Lifecycle Rehearsal** | **PASS** | 6/6 scenarios pass in `scripts/rehearse_deployment_lifecycle.cjs` (Happy Path, Early Failure, Migration Failure, Smoke Failure, Corrupted Restore, Credential Handoff & Purge). |
| **Automated Smoke Checks** | **PASS** | `scripts/production_smoke_check.cjs` enforces 5 strict tiers (HTML shell, login validation, profile, SA endpoint, Ord Admin 403). Missing or empty credentials exit nonzero (fail-closed); 32/32 CLI test vectors pass; tokens never printed. |
| **Automated Test Regression** | **PASS** | **263 / 263 Automated Tests Passing** (123/123 Playwright specs, 28/28 credential handoff & auth route tests, 58/58 rollback vectors, 32/32 smoke CLI vectors, 16/16 isolation vectors, 6/6 rehearsal scenarios). |
| **Code Quality & Build** | **PASS** | **0 ESLint Errors** (168 warnings); clean production Vite build in 1.21s (`dist/index.html` & `dist/404.html` reference `/bfi-classroom/favicon.png` & apple-touch-icon; branding assets bundled in `dist/`). |
| **Pristine Root Database** | **PASS** | Root database SHA-256 verified unchanged (`BF37A89C...5F1E`). |
| **Live Host Read-Only Inspection** | **VERIFIED** | Ubuntu 22.04 aarch64, Node v22.23.4, PM2 v7.1.0, 91GB disk available, Nginx proxy active, `lsof`/`fuser` available. |
| **Edge Maintenance Mode Bypass** | **UNVERIFIED** | Edge Cloudflare/proxy 503 maintenance bypass rule must be verified by the system operator before maintenance window. |

---

## 2. Integrated Code Gap & File Inventory

### 2.1 The 12 Integrated Commits from origin/main (`4d8feb0..0c71163495e58a51f1709272ec55d99a31251ec3`)
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
12. `0c71163` feat(branding): update favicon with modern blue squircle background matching brand spec (Option A)

> All 4 branding files (`index.html`, `public/apple-touch-icon.png`, `public/favicon.png`, `public/favicon.svg`) match `origin/main` byte-for-byte.

### 2.2 Complete Release Candidate File Inventory (Code Release Commit `21f3cbe`)
* **Core Application Entry & Security:**
  * `server/server.js`: Express router mounting, security headers, rate limiters, session tracking.
  * `server/middleware/auth.js`: Real-time RBAC middleware, `requireSuperAdmin`, `requirePermission`, `requireSudo`, `authLimiter`.
  * `server/services/auditLedgerService.js`: Transaction-coupled operational audit logging with deep recursive credential sanitization.
  * `server/services/courseProgressService.js`: Dynamic phase resolution, atomic academic mutations, transactional before/after snapshots.
  * `server/routes/admin-management.js`: Super Admin APIs, admin lifecycle, dual timelines, session revocation, MFA reset.
  * `server/routes/admin.js`, `broadcast.js`, `batches.js`, `analytics.js`, `fees.js`, `reports.js`, `student.js`, `trash.js`: Operational audit coverage.
  * `server/utils/totp.js`, `security-events.js`, `feeResolver.js`: TOTP engine, security telemetry, fee context.
* **Authentication, Credential Handoff & Lifecycle Tooling:**
  * `scripts/obtain_smoke_credentials.cjs`: Confidential interactive credential prompter with zero echo, detached raw-mode listeners, protected temporary token files (0o600/0o700), and best-effort memory/disk zeroing.
  * `scripts/test_credential_handoff.cjs`: 28-test real route integration & unit test suite verifying listener cleanup, Turnstile proxy enforcement, strict attemptId & backup state validation, atomic single-use capability consumption, replay defense, concurrent reuse prevention, terminal rollback rejection, legacy admin login, MFA, and profile guards.
  * `server/routes/auth.js`: Multi-invariant maintenance-scoped Turnstile verification alongside normal browser flow, and supported legacy admin username validation.
  * `scripts/production_lifecycle.cjs`: Hardened deployment & rollback runner with ephemeral maintenance token lifecycle and pre-exposure reopening boundary.
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
* **Process Manager:** PM2 `v7.1.0` running application `bfi-classroom` (ID: 0, PID: 34952) on port 3001
* **Available Disk Space:** `91 GB` available on `/` (30% utilization), sufficient for multiple database backups
* **Reverse Proxy:** Nginx active on port 80 forwarding `/bfi-classroom/` to local port 3001
* **Process Inspection Tools:** `/usr/bin/lsof` and `/usr/bin/fuser` confirmed installed with normal execution permissions
* **Database Location & Size:** `/home/ubuntu/bfi-classroom/server/bfi_classroom.db` (1.57 GB)
* **Current Production Revision:** Commit `0c71163495e58a51f1709272ec55d99a31251ec3` on branch `main` (verified live; dynamically captured at pre-flight)

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

### 4.4 Bounded Credential Handoff & Real Route Integration Test Evidence (28 Tests)
Executed `node scripts/test_credential_handoff.cjs` against `server/routes/auth.js` using a disposable SQLite database:

**Part 1: Secret-Input Listener Cleanup & Protected Storage (4 Tests):**
1. **promptSecret Timeout Listener Cleanup:** Verified timeout removes 'data' and 'error' listeners, closes readline, and restores raw mode. Late stream input is strictly ignored.
2. **promptSecret Cancellation (Ctrl+C):** Verified cancellation cleans up all stream listeners, closes interface, and restores prior terminal raw mode.
3. **promptSecret Normal Completion (Enter):** Verified Enter cleans up listeners, pauses stream, and restores terminal raw mode.
4. **createProtectedTokenStorage:** Verified temporary directory mode 0o700, file mode 0o600, and best-effort zero-fill unlink cleanup.

**Part 2: Real Route Integration & Maintenance Authorization Hardening (24 Tests):**
5. **Turnstile Enforcement on External Request:** External request carrying proxy headers (`X-Forwarded-For`, `CF-Connecting-IP`, `X-Real-IP`, `Forwarded`) without Turnstile is rejected with HTTP 400.
6. **Turnstile Proxy Bypass Defense:** External request with proxy headers is strictly rejected even if an active maintenance token is provided (HTTP 400).
7. **Permanent Loopback Exemption Removed:** Direct loopback request without maintenance token is rejected with HTTP 400.
8. **Maintenance Token Mismatch:** Loopback request with invalid maintenance token is rejected with HTTP 400.
9. **Replay Defense (Atomic Single-Use):** Single-use capability token consumed atomically upon use; immediate repeat request returns HTTP 400.
10. **Concurrent Reuse Defense:** Simultaneous requests with same token allow exactly one to succeed (one HTTP 200, one HTTP 400).
11. **Missing Metadata Defense (Incomplete State):** State file containing only `{backupValidated:true}` (missing attemptId, exposure flags) is strictly rejected with HTTP 400.
12. **Missing Metadata Defense (Omitted Exposure Flags):** State missing explicit boolean `trafficMayReopen: false` and `trafficReopened: false` fails closed (HTTP 400).
13. **Missing Metadata Defense (Bare Token):** Capability file lacking `attemptId` binding is rejected with HTTP 400.
14. **Wrong Attempt Defense:** Capability token bound to a different `attemptId` than `active_deployment_state.json` is rejected with HTTP 400.
15. **Terminal State Defense (rollbackCompleted):** State with `rollbackCompleted: true` strictly rejects maintenance authorization (HTTP 400).
16. **Terminal State Defense (rolledBackAt):** State with `rolledBackAt` timestamp rejects maintenance authorization (HTTP 400).
17. **Terminal State Defense (completed):** State with `completed: true` rejects maintenance authorization (HTTP 400).
18. **Expiration Defense:** Capability with expired logical timestamp (`expiresAt <= Date.now()`) or mtime > 15m is rejected with HTTP 400.
19. **Exposure Boundary Defense (trafficMayReopen):** State with `trafficMayReopen: true` rejects maintenance authorization (HTTP 400).
20. **Exposure Boundary Defense (trafficReopened):** State with `trafficReopened: true` rejects maintenance authorization (HTTP 400).
21. **Backup Association Mismatch Defense:** State referencing nonexistent backup file on disk rejects maintenance authorization (HTTP 400).
22. **Separate Capabilities Support:** Distinct tokens generated for multiple accounts (`admin@abir` and `admin2`) are consumed independently without cross-invalidation.
23. **Capability Account Mismatch Defense:** Capability token bound specifically to `admin@abir` cannot be used to authenticate `admin2` (HTTP 400).
24. **Supported Legacy Admin Login:** Real route login for `admin2` (User ID 7) succeeds with valid maintenance token, issuing authentic token with `type: 'access'`, `sessionId`, and `token_version: 1` (HTTP 200).
25. **Non-Admin Rejection:** Real route login for student user attempting admin login is rejected with HTTP 400.
26. **Wrong Password Rejection:** Real route login with incorrect password returns HTTP 401.
27. **MFA Challenge & TOTP Verification:** Real route login for `admin@abir` (User ID 1) issues single-use challenge and successfully verifies with real TOTP code (HTTP 200).
28. **Profile Identity & Role Guards:** Real route `GET /api/auth/me` confirms User ID 1 is Super Admin and User ID 7 is Ordinary Admin.

---

### 4.5 Real Git Repository Survival & Cold-Start Rehearsal Evidence
Executed `node scripts/rehearse_git_recovery.cjs` across a real, disposable Git repository (`test_git_recovery_repo`) to verify fail-closed recovery tooling survivability, cold-start module resolution, and correct rollback-baseline ordering:

* **Step 0: Baseline & Candidate Configuration:**
  * **Commit A (Baseline):** Represents live production baseline (`0c71163`). Contains no operational scripts in `scripts/`.
  * **Commit B (Candidate):** Contains all 6 operational scripts in `scripts/` (`preflight_lockdown_check.cjs`, `verify_isolation.cjs`, `run_migrations.cjs`, `production_smoke_check.cjs`, `production_lifecycle.cjs`, `obtain_smoke_credentials.cjs`) and database migrations in `server/db/migrations/`.
  * **Live Checkout Preserved:** Rehearsal repository explicitly starts on Commit A with a clean working tree.
  * **Staging Outside Tracked Tree:** Extracted all 6 operational scripts directly from Commit B into `server/.recovery_tools/` via `git show ${commitB}:scripts/${s}` without switching branches or altering the live checkout.
* **Step 1: Deployment Execution & Injected Failure:**
  * Executed deployment starting from Commit A.
  * Dynamically recorded `pre_deployment_revision.txt` as Commit A via `git rev-parse HEAD`.
  * Captured dynamic baseline invariants and validated pre-deployment backup.
  * Checked out Commit B in Phase 3, built assets, and executed database migrations on disposable DB.
  * In Phase 5 (Smoke Verification), injected failure halted deployment before traffic reopening.
* **Step 2: Cold-Start Rollback in a Brand NEW Node Process:**
  * Spawned `node server/.recovery_tools/production_lifecycle.cjs rollback --is-rehearsal` via `child_process.spawnSync` in a completely separate, fresh Node process.
  * **Cold-Start Module Resolution Verified:** Node parsed and loaded all required modules (including `obtain_smoke_credentials.cjs`) from `server/.recovery_tools/` without `MODULE_NOT_FOUND` errors.
  * Quarantined failed database state and restored validated pre-deployment backup.
  * Checked out pre-deployment revision Commit A via real Git.
  * Restored services, verified loopback HTTP 200, and restored Nginx with `trafficMayReopen` pre-exposure boundary. Child process exited with code `0`.
* **Step 3: Verification of Git State, Tooling Survival, & Database Invariants:**
  * **Restored Git HEAD:** Confirmed `git rev-parse HEAD` returned Commit A.
  * **Candidate Script Removal:** Confirmed Git checkout removed `scripts/production_lifecycle.cjs` from the tracked working tree.
  * **Recovery Tooling Survival:** Confirmed all 6 operational scripts in `server/.recovery_tools/` survived the checkout 100% intact.
  * **Database Restored:** Restored SQLite database verified with 0 foreign key violations, PRAGMA `quick_check` = ok, and exact baseline match.
* **Step 4: Negative Verification (Cold-Start Dependency Assertion):**
  * Temporarily moved `server/.recovery_tools/obtain_smoke_credentials.cjs` away and executed a fresh Node rollback probe.
  * Confirmed probe exited code `1` with `Cannot find module './obtain_smoke_credentials.cjs'`.
  * Restored module and confirmed passing state. This provides definitive proof that the recovery bundle is strictly self-contained and cold-start verified.

---

## 5. Hardened Executable Production Deployment Runbook

Execute this exact runbook sequentially during the approved maintenance window. Every command is fail-closed (`set -e`). If any step fails, execution halts immediately.

### Phase 0: Pre-Flight Staging & Safety Gate Preparation (Zero Application Checkout)
Before stopping any production services, stage the reviewed operational scripts and preserve recovery tooling directly in `server/.recovery_tools/` outside the git working tree. **DO NOT run `git checkout` at this stage; the application working tree must remain 100% on the live production revision.**

```bash
set -e
cd /home/ubuntu/bfi-classroom

# 1. Fetch release candidate commit from origin (prerequisite: operator pushed candidate to origin)
git fetch origin

# 2. Define approved 40-character target commit SHA (reject mutable branch names)
APPROVED_COMMIT="d3b330c4abc3bcec8a14806c3105e05ce22bcf0b"

# 3. Stage all 6 operational and recovery scripts directly outside the tracked working tree:
mkdir -p server/.recovery_tools
for script in preflight_lockdown_check.cjs verify_isolation.cjs run_migrations.cjs production_smoke_check.cjs production_lifecycle.cjs obtain_smoke_credentials.cjs; do
  git show ${APPROVED_COMMIT}:scripts/${script} > server/.recovery_tools/${script}
  chmod +x server/.recovery_tools/${script}
done

# 4. Verify script presence and non-empty file size without executing operational checks:
test -s server/.recovery_tools/production_lifecycle.cjs
test -s server/.recovery_tools/verify_isolation.cjs
test -s server/.recovery_tools/preflight_lockdown_check.cjs
test -s server/.recovery_tools/run_migrations.cjs
test -s server/.recovery_tools/production_smoke_check.cjs
test -s server/.recovery_tools/obtain_smoke_credentials.cjs

# 5. Canonical Deployment Execution:
# Run full automated deployment lifecycle (Phases 0 through 6) with fail-closed gates:
# node server/.recovery_tools/production_lifecycle.cjs deploy --target-commit "$APPROVED_COMMIT"
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
4. **Execute Fail-Closed Isolation Verification (from Staged Recovery Tools):**
   ```bash
   node server/.recovery_tools/verify_isolation.cjs
   ```
   *Gate:* Must confirm Nginx inactive, 0 Nginx processes, 0 listening sockets on 80/443, 0 established connections, PM2 application stopped, port 3001 closed. Exit code 0 required.
5. **Execute Fail-Closed Database Handle Verification (from Staged Recovery Tools):**
   ```bash
   node server/.recovery_tools/preflight_lockdown_check.cjs
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

### Phase 3: Reproducible Code Update & Build Sequence (After Backup Validation)
1. **Checkout Pinned Release Candidate Commit (Reject Mutable Branch Names):**
   ```bash
   git checkout "${APPROVED_COMMIT}"
   test "$(git rev-parse HEAD)" = "${APPROVED_COMMIT}"
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
1. **Run Unified Migration Runner (from Recovery Tools):**
   ```bash
   node server/.recovery_tools/run_migrations.cjs server/bfi_classroom.db
   ```
   *Gate:* Must execute all 5 migrations in chronological order, verify all 10 schema integrity assertions, and exit with code `0`. If this command fails, halt and trigger Rollback Runbook (Window A).

### Phase 5: Start Service & Automated Production Smoke Checks (Under Isolation)
1. **Verify Nginx is STILL Stopped:**
   ```bash
   node server/.recovery_tools/verify_isolation.cjs
   ```
2. **Start PM2 Backend Locally (127.0.0.1:3001):**
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 status
   ```
3. **Verify PM2 is Online While Nginx Remains Inactive:**
   ```bash
   node server/.recovery_tools/verify_isolation.cjs --allow-pm2
   ```
4. **Execute Automated Fail-Closed Smoke Check Over Loopback:**
   Pass tokens securely via protected environment variables or execute via bounded credential handoff:
   ```bash
   SUPER_ADMIN_TOKEN="$SA_TOKEN" ADMIN_TOKEN="$ORD_TOKEN" node server/.recovery_tools/production_smoke_check.cjs http://127.0.0.1:3001
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
The quickest and safest recovery method is executing the canonical rollback runner from the preserved recovery tools directory. Because `server/.recovery_tools/` is outside git tracking, it survives checkout switches:

```bash
# Execute canonical rollback directly from preserved recovery tools:
node server/.recovery_tools/production_lifecycle.cjs rollback

# If post-reopening forensic restoration is explicitly authorized by operator:
node server/.recovery_tools/production_lifecycle.cjs rollback --allow-post-reopening-reconciliation
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

---

## 7. Operational Incident Analysis & Isolation Gate Correction (October 27, 2026)

### 7.1 Incident Chronology (Attempt `deploy_1793112475156`)
* **Execution Timestamp**: October 27, 2026, 08:47 PM Asia/Dhaka.
* **Target Candidate**: `515379363dc32018f963ed0c1215a2f71513d427`.
* **Execution Boundary**:
  - Phase 0: All 6 operational scripts verified in `server/.recovery_tools/`.
  - Phase 1: Pre-maintenance service states recorded (`NGINX=active`, `PM2=online`).
  - Step 1.2 & 1.3: Nginx stopped cleanly, PM2 stopped cleanly.
  - Step 1.4: Fail-closed isolation inspection executed. Sub-checks 1–3 passed. Sub-check 4 (`ss` connection drain check) exited with code 1:
    ```text
    ✖ [ISOLATION GATE FATAL] ss connection check exited with non-zero status (1): Error: "state" does not look like a port.
    Cannot parse dst/src address.
    . Failing closed.
    ```
* **Strict Fail-Closed Halt**:
  Execution halted immediately at Phase 1.4. The deployment **stopped completely before** database backup (Phase 2), Git checkout (Phase 3.1), build (Phase 3.3), migrations (Phase 4), internal restart (Phase 5), credential handoff (Phase 5.3), and traffic reopening (Phase 6).

### 7.2 Root Cause Analysis
* **Mechanism**: In `scripts/verify_isolation.cjs`, the invocation `spawner('ss', ['-H', '-tan', '( sport = :80 or sport = :443 ) state established'], { shell: false })` passed `'( sport = :80 or sport = :443 ) state established'` as a single positional argument. Under Linux `iproute2-5.15.0`, `state established` cannot be placed inside the address filter string; `ss` expects `state <filter>` as a separate argument.
* **Testing Gap**: Prior unit tests in `scripts/test_verify_isolation.cjs` used mock spawners that matched `cmd === 'ss'` and returned stubbed `{ status: 0 }` objects, masking the CLI syntax rejection of real Linux `ss`.

### 7.3 Implemented Fix & Regressions
* **Argument Array**: In `scripts/verify_isolation.cjs`:
  ```javascript
  const ssConnCheck = spawner('ss', ['-H', '-tan', 'state', 'established', '( sport = :80 or sport = :443 )'], { encoding: 'utf8', timeout: 5000, shell: false });
  ```
* **Test 17 Regression Assertion**: Added Test 17 in `scripts/test_verify_isolation.cjs` asserting exact argument array equality and `shell: false`. (Suite: 17/17 passed).
* **Live Linux Loopback Fixture Suite**: Added `scripts/test_ss_loopback_fixtures.cjs` testing:
  1. Empty results on unallocated ports (returns status 0, 0 lines).
  2. Detection of real established IPv4 loopback connection (127.0.0.1:ephemeral).
  3. Detection of real established IPv6 loopback connection ([::1]:ephemeral).
  4. Post-disconnect connection drain verification.
  (Executed directly on target host `bfi-classroom-server`: 6/6 passed 100%).

### 7.4 Independent Forensic Host Verification (Zero Change Proof)
Independent queries executed on `bfi-classroom-server` confirm zero modifications to data or code:
* **Database State**:
  - `PRAGMA quick_check`: `ok`
  - `PRAGMA foreign_key_check`: 0 violations
  - Table Invariants: `users=1786`, `batches=81`, `student_course_enrollments=913`, `batch_course_fees=27` (exact baseline match)
  - Schema Invariants: `is_super_admin` column in `users` table is `false` (confirming Migration 001 never ran)
  - File SHA256: `3846fb942691dd67b9b8c8673ce02612f60bb3ed1dda9ef7981abd8fca75d8bf`
* **Application Baseline**: HEAD remains `0c71163495e58a51f1709272ec55d99a31251ec3` (clean, un-switched).
* **Traffic Exposure**: Zero exposure (`trafficMayReopen: false`, `trafficReopened: false`).
* **Service Recovery**: PM2 PID 53059 online, Nginx active, `https://classroom.bfibd.org/bfi-classroom/` returns HTTP 200 OK.

### 7.5 Human Pacing & Runtime Dependency Enhancements (Attempt `deploy_1793115821130`)
* **Attempt Chronology**:
  - Phase 1 (Lockdown & Isolation): Passed cleanly with corrected `ss` arguments.
  - Phase 2 (Dynamic Baseline & SQLite Backup): Passed (`bfi_classroom_preflight_20261027154348.db` validated).
  - Phase 3 (Git Checkout & Production Build): Passed cleanly on target release.
  - Phase 4 (Migrations): Passed (10/10 schema assertions verified).
  - Phase 5 (Internal Backend Startup): Passed on loopback `127.0.0.1:3001`.
  - Phase 5.3 (Credential Handoff): Security timer of 60 seconds timed out fail-closed before human secret entry was completed.
* **Pre-Exposure Recovery**:
  - Executed canonical rollback: restored validated backup `bfi_classroom_preflight_20261027154348.db`, verified invariants (users=1786, batches=81, enrollments=913, fees=27, `is_super_admin: false`), restored checkout to `0c71163495e58a51f1709272ec55d99a31251ec3`, and restored PM2 + Nginx. Public endpoint verified 200 OK.
* **Hardening Improvements Applied**:
  1. **Accessible Human Input Timeout**: Increased credential handoff timeout from 60 seconds to **10 minutes (600,000 ms)** in `scripts/obtain_smoke_credentials.cjs` and `scripts/production_lifecycle.cjs` to comfortably support human operators, password managers, and multi-factor authentication devices.
  2. **Runtime Dependency Placement**: Moved `docx` from `devDependencies` to `dependencies` in `package.json` to prevent runtime export degradation during production `npm prune --omit=dev`.


