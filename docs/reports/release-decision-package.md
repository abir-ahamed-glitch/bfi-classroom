# BFI Classroom Release Decision Package & Staging Specification

**Date:** October 29, 2026  
**Candidate Worktree:** `.worktrees/super-admin-integration`  
**Candidate Branch:** `integration/super-admin-candidate`  
**Application Commit (Code & Tests proposed for staging):** `50434d6b691fbe0f70b4c4fb48b453b7e62217b7` (short: `50434d6`)  
**Documentation Commit:** `804eb7fcb3a68aed8906d582e5b016e3945a9bce` (short: `804eb7f`)  
**Base Commit (origin/main):** `0c71163495e58a51f1709272ec55d99a31251ec3`  
**Reviewed Base Commit:** `c6322facc753d35fc28c16a8d9a279814e11d221`  
**Deployment Authorization Status:** **EXPLICITLY PENDING (DEPLOYMENT STRICT NO-GO)**  
**Staging Authorization Status:** **PREPARATION ONLY (AWAITING REVIEW BEFORE HOST EXECUTION)**  
**Pristine Root DB SHA-256:** `BF37A89C3F0DA1038E2E9A8FA18916D9A2986541A062C9AB40EE51E4987F5F1E`

---

## 1. Remaining PDF Viewer Choice (Plain Language Analysis)

The application currently depends on `pdfjs-dist@3.11.174` and `@react-pdf-viewer/core@3.12.0`. Upgrading `pdfjs-dist` to the patched v4+ releases is blocked because `@react-pdf-viewer/core` specifies a hard peer dependency constraint (`^2.16.105 || ^3.0.279`), and PDF.js v4 dropped CommonJS distribution, moved to pure ESM, and changed internal canvas rendering signatures.

Because of this blocker, 19 high-severity vulnerability entries remain in `npm audit` (all originating from this single viewer dependency chain, centered on CVE-2024-4367).

The system owner has two viable options:

```
+--------------------------------------------------------------------------------------------------+
| OPTION A: Temporarily Retain with Runtime Mitigation (Recommended for Controlled Staging)       |
+--------------------------------------------------------------------------------------------------+
| What it is:                                                                                      |
|   Keep pdfjs-dist@3.11.174 and dedicated worker pdf.worker.min.js with isEvalSupported: false    |
|   passed to getDocument() across all 4 application paths:                                        |
|     1. PdfViewer.jsx (react-pdf-viewer preview component)                                       |
|     2. BulkStudentImport.jsx (admissions candidate import)                                       |
|     3. BulkRegisteredStudentImport.jsx (enrolled student batch import)                            |
|     4. UploadResultsModal.jsx (exam score sheet import)                                          |
|                                                                                                  |
| Tradeoffs:                                                                                       |
|   [+] Preserves existing UI behavior across all 4 components; verified in 10/10 application-     |
|       level Chromium integration tests without UI regression.                                    |
|   [+] Neutralizes the specific arbitrary code execution gadget (CVE-2024-4367) by disabling      |
|       dynamic Function()/eval compilation in font matrix evaluation.                             |
|   [+] Web Workers isolate heavy PDF parsing from the main JavaScript UI thread, preventing UI     |
|       freezing during document processing.                                                       |
|   [-] 19 high vulnerabilities remain in npm audit.                                               |
|   [-] Web Workers provide execution and UI thread isolation, NOT a general security sandbox     |
|       or OS-level boundary against browser memory corruption.                                    |
|   [-] Does NOT fix any potential unpatched binary parsing flaws in the older PDF.js engine.      |
|   [-] Requires formal written risk acceptance from the repository owner before deployment.       |
+--------------------------------------------------------------------------------------------------+
| OPTION B: Replace with Maintained, Patched Viewer Before Deployment                              |
+--------------------------------------------------------------------------------------------------+
| What it is:                                                                                      |
|   Completely remove @react-pdf-viewer and replace it with a modern PDF.js v4+ custom canvas      |
|   viewer, standard browser PDF iframe/embed integration, or PDFObject.                           |
|                                                                                                  |
| Tradeoffs:                                                                                       |
|   [+] Eliminates the 19 high vulnerabilities in npm audit.                                       |
|   [+] Receives ongoing security updates directly from Mozilla PDF.js maintainers.                |
|   [-] Delays release; requires rewriting PdfViewer.jsx and re-verifying UI controls.             |
|   [-] Potential cross-browser styling and zoom/pan discrepancies compared to react-pdf-viewer.   |
+--------------------------------------------------------------------------------------------------+
```

### Recommendation
**Recommend Path A for immediate Linux ARM64 staging rehearsal, coupled with a scheduled Sprint 1 follow-up migration to Path B:**
1. If the owner accepts Path A temporarily, staging rehearsal can proceed without code rework, because `isEvalSupported: false` and dedicated Web Worker isolation have been verified across all 4 application components in Playwright Chromium tests.
2. If the owner requires a zero-vulnerability audit baseline prior to any production deployment, **Path B must be selected**, and deployment remains blocked until the viewer replacement is implemented and verified.
*(Do not assume acceptance: formal owner written sign-off is mandatory before production deployment).*

---

## 2. Isolated Linux ARM64 Staging Plan

**Target Host:** `bfi-classroom-server` (`129.221.243.153`, Ubuntu 22.04 LTS aarch64)  
**Strict Safety Rule:** Production files, database (`server/bfi_classroom.db`), and services (`pm2` process `bfi-classroom`, Nginx port 80/443 public routes) must remain completely untouched. Staging authorization is strictly separate from production risk acceptance and deployment authorization.

### 2.1 Staging Environment Isolation Topology
- **Isolated Directory:** `/var/www/bfi-classroom-staging`
- **Isolated Database:** `/var/www/bfi-classroom-staging/server/staging_classroom.db`
- **Isolated Loopback Port:** `PORT=3002` strictly bound to `HOST=127.0.0.1` (never `0.0.0.0`)
- **Dedicated Staging Process:** `pm2 start server/staging-server.js --name bfi-classroom-staging --cwd /var/www/bfi-classroom-staging`
- **Isolated Credentials:** `/var/www/bfi-classroom-staging/.env.staging` with unique synthetic secrets.
- **Zero Outbound Services:** `EMAIL_USER=""`, `EMAIL_PASS=""`, and `SMTP_PASS=""` nullified in `.env.staging` to guarantee zero outbound emails or notifications.
- **Isolated Uploads & Logs:** Uploads directed to staging uploads directory; logs isolated to staging PM2 logs (`~/.pm2/logs/bfi-classroom-staging-*.log`).
- **Synthetic Data Only:** Staging uses generated test records (`staging-admin@bfi.local`); live production data is never copied or accessed.

### 2.2 Staging Configuration & ESM Import Order
In Node.js ES modules, static `import` declarations evaluate before module-level statements. In [`server/server.js`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/.worktrees/super-admin-integration/server/server.js), static `import db from './db/database.js'` executes *before* `dotenv.config()` runs. If `DATABASE_PATH` is not set in `process.env` prior to process startup, `database.js` defaults to `server/bfi_classroom.db`.

To eliminate this risk, staging uses the dedicated entrypoint [`server/staging-server.js`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/.worktrees/super-admin-integration/server/staging-server.js):
1. It loads `.env.staging` through [`scripts/staging_guard.cjs`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/.worktrees/super-admin-integration/scripts/staging_guard.cjs).
2. It primes `process.env.DATABASE_PATH`, `process.env.PORT=3002`, and `process.env.HOST=127.0.0.1`.
3. It only calls dynamic `import('./server.js')` *after* all staging environment variables and path guards have passed validation.

### 2.3 Staging Database Initialization & Path Guard
Importing `server/db/database.js` does **not** create schema tables; table creation requires calling `initializeDatabase()`.
The explicit staging database initialization command is:
```bash
node scripts/init_staging_db.cjs .env.staging
```
This utility:
1. Validates `.env.staging` via [`scripts/staging_guard.cjs`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/.worktrees/super-admin-integration/scripts/staging_guard.cjs).
2. Verifies that `DATABASE_PATH` is defined, absolute, and resolves outside production. Using `fs.realpathSync`, it checks that the path does **not** resolve to `/var/www/bfi-classroom/server/bfi_classroom.db` or any symlink pointing inside `/var/www/bfi-classroom/`. If a production path or symlink is detected, execution aborts immediately (`SAFETY REJECTION`) before any SQLite connection or write occurs.
3. Dynamically imports `server/db/database.js` with `process.env.DATABASE_PATH` bound to the staging DB.
4. Invokes `initializeDatabase()`, creating all 64 schema tables (including `users`, `student_profiles`, `course_definitions`, `batches`, `batch_students`, `announcements`, `admin_audit_logs`, and `action_bound_challenges`).
5. Verifies database integrity via `PRAGMA quick_check` and `PRAGMA foreign_key_check`.
6. Seeds a synthetic staging Super Admin account (`staging-admin@bfi.local`) with unique credentials.

### 2.4 Network Isolation & Frontend Serving Architecture
1. **Loopback Binding:** [`server/server.js`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/.worktrees/super-admin-integration/server/server.js#L818-L824) inspects `process.env.HOST`. If `HOST` is provided (e.g. `127.0.0.1`), it calls `httpServer.listen(PORT, HOST, ...)`. In `.env.staging`, `HOST=127.0.0.1` and `PORT=3002`. [`scripts/staging_guard.cjs`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/.worktrees/super-admin-integration/scripts/staging_guard.cjs) strictly rejects `HOST !== '127.0.0.1'` and `PORT === 3001`, preventing external network exposure.
2. **Frontend Build & Serving:**
   - In `vite.config.js`, the Vite dev server port `server.port` is hardcoded to `5174` and does **not** read `VITE_PORT` from the environment. Running a separate Vite dev server in staging adds unnecessary proxy layers.
   - The staging backend (`server/server.js`) natively serves the built frontend:
     `app.use('/bfi-classroom', express.static(distPath));`
     and handles client-side SPA routing by returning `dist/index.html` on `/bfi-classroom/*`.
   - Therefore, the staging procedure executes `npm run build` once, and the frontend is served directly through the loopback backend server at `http://127.0.0.1:3002/bfi-classroom/`, exactly matching production serving architecture.

### 2.5 Local Disposable Validation Evidence
Before proposing host execution, this complete staging architecture was verified locally in a disposable environment via [`scripts/test_staging_isolation.cjs`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/.worktrees/super-admin-integration/scripts/test_staging_isolation.cjs). All 7/7 tests passed:
1. Rejection of production database path (`SAFETY REJECTION`).
2. Rejection of production port 3001.
3. Rejection of non-loopback `HOST` (`0.0.0.0`).
4. Explicit loading of `.env.staging` before database imports.
5. Staging DB initialization and schema verification (64 tables created, `PRAGMA quick_check` OK).
6. Staging server startup on `127.0.0.1:3002`, loopback binding, SPA shell return (HTTP 200 on `/bfi-classroom/`), and API routing validation.
7. Clean process termination and temporary directory cleanup.

---

### 2.6 Step-by-Step Staging Runbook for Host Operator

#### Step 1: Directory Setup & Clean Checkout
```bash
sudo mkdir -p /var/www/bfi-classroom-staging
sudo chown -R $USER:$USER /var/www/bfi-classroom-staging
cd /var/www/bfi-classroom-staging
git clone <repo_url> .
git checkout 50434d6b691fbe0f70b4c4fb48b453b7e62217b7
```

#### Step 2: Configure Staging Environment (.env.staging)
Create `/var/www/bfi-classroom-staging/.env.staging`:
```ini
NODE_ENV=production
PORT=3002
HOST=127.0.0.1
DATABASE_PATH=/var/www/bfi-classroom-staging/server/staging_classroom.db
JWT_SECRET=<random_64_hex_staging_only>
JWT_REFRESH_SECRET=<random_64_hex_staging_only>
MFA_ENCRYPTION_KEY=<random_32_hex_staging_only>
EMAIL_USER=
EMAIL_PASS=
SMTP_PASS=
```

#### Step 3: Clean Dependency Installation
```bash
npm ci --legacy-peer-deps
```
*Verification Check:* Confirm `@img/sharp-linux-arm64` and `@img/sharp-libvips-linux-arm64` are installed without invoking `node-gyp` or C++ compilation on Ubuntu 22.04 aarch64 (glibc 2.35).

#### Step 4: Build Client Assets
```bash
npm run build
```
*Verification Check:* Confirm `dist/index.html` and `dist/assets/` are successfully compiled.

#### Step 5: Initialize Staging Database
```bash
node scripts/init_staging_db.cjs .env.staging
```
*Verification Check:* Confirm `staging_guard` validates paths, 64 tables are created, `PRAGMA quick_check` returns OK, and synthetic user `staging-admin@bfi.local` is provisioned.

#### Step 6: Native Sharp & Email Execution Probes
```bash
node scripts/test_sharp_processing.cjs
node scripts/test_nodemailer_transport.cjs
```
*Verification Check:* Confirm 9/9 image processing tests and 9/9 mock SMTP loopback tests pass on ARM64 with zero segmentation faults and zero real emails sent.

#### Step 7: Start Isolated Staging Service
```bash
pm2 start server/staging-server.js --name bfi-classroom-staging --cwd /var/www/bfi-classroom-staging
```
*Verification Check:*
```bash
# Verify process status
pm2 status bfi-classroom-staging

# Verify production process is completely untouched
pm2 status bfi-classroom

# Verify loopback binding on port 3002 (never public)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3002/bfi-classroom/
# Output must be: 200

# Verify API routing
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3002/api/auth/login
# Output must be: 400 (Bad Request on empty body)
```

#### Step 8: PDF Component & UI Flow Validation
Through SSH tunnel (`ssh -L 3002:127.0.0.1:3002 operator@129.221.243.153`):
1. Navigate browser to `http://localhost:3002/bfi-classroom/`.
2. Log in using `staging-admin@bfi.local`.
3. Test PDF imports in `BulkStudentImport`, `BulkRegisteredStudentImport`, and `UploadResultsModal` using test fixtures.
4. Verify browser DevTools: `pdf.worker.min.js` loads (HTTP 200), dedicated Web Worker handles parsing, and `isEvalSupported: false` is enforced.

#### Step 9: Staging Teardown & Process Cleanup
```bash
pm2 stop bfi-classroom-staging
pm2 delete bfi-classroom-staging
# (Do NOT run pm2 save; do NOT touch bfi-classroom)
```

---

## 3. Production Operator Checklist

Prior to initiating the maintenance window on `bfi-classroom-server`, the operator must execute and verify the following steps:

### 3.1 GitHub Approval Protections (SEC-11)
- [ ] In GitHub repository settings (**Settings > Environments**), verify the `production` environment exists.
- [ ] Verify **Required reviewers** is enabled and assigned to authorized repository maintainers.
- [ ] Verify **Deployment branches** is restricted to `main` or protected release tags.
- [ ] Confirm that `.github/workflows/deploy.yml` requires manual promotion before executing commands on the production host.

### 3.2 Secure Credential Rotation (SEC-01)
- [ ] **Preserve Existing MFA Decryption Key:**
  - Copy the *currently active* key to `PREVIOUS_MFA_ENCRYPTION_KEY=<current_value>` in `.env` (or set to legacy `JWT_SECRET` if this is the initial migration).
  - Generate a single fresh 32-byte hex key for `MFA_ENCRYPTION_KEY`:
    ```bash
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    ```
  - This preserves fallback decryption in [`server/utils/totp.js`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/.worktrees/super-admin-integration/server/utils/totp.js) so existing user authenticators remain valid.
- [ ] Generate fresh 64-character hex strings for `JWT_SECRET` and `JWT_REFRESH_SECRET` (never use `REFRESH_TOKEN_SECRET`).
- [ ] Configure dedicated transactional SMTP application password.
- [ ] Update Cloudflare Turnstile secret and site keys.
- [ ] Rehearse rotation logic on disposable test data:
  ```bash
  node scripts/rehearse_mfa_rotation.cjs
  ```

### 3.3 Maintenance Window, Backup & Rollback Boundaries
- [ ] **Approved Commit:** Confirm deployment target is pinned to verified application commit `50434d6b691fbe0f70b4c4fb48b453b7e62217b7` (or its clean merge commit on `main`).
- [ ] **Phase 0 Credential Gate:** Ensure valid smoke credentials (`SUPER_ADMIN_TOKEN` and `ADMIN_TOKEN`) are generated with >=15-minute expiration buffer (`exp - now >= 900s`).
- [ ] **Pre-Disruption Zero-Stop:** Verify that if credentials fail preflight validation, Phase 0 aborts with **zero services stopped**.
- [ ] **Phase 2 SQLite Backup:** Verify SQLite native `.backup` completes and passes `PRAGMA quick_check` and `PRAGMA foreign_key_check`.
- [ ] **Safe Rollback Boundary:**
  - If failure occurs in Phase 0 or Phase 1, the live database was never touched; rollback restores Nginx/PM2 without restoring older backups.
  - If failure occurs in Phase 3–5, rollback quarantines corrupted database and restores the freshly validated Phase 2 backup.
- [ ] **Post-Deployment Verification:** Run canonical 18-assertion smoke check:
  ```bash
  node scripts/production_smoke_check.cjs
  ```

---

## 4. Verification & Evidence Status Matrix

```
+--------------------------------------------------------------------------------------------------+
| LAYER / CAPABILITY                  | STATUS               | EVIDENCE SOURCE                     |
+-------------------------------------+----------------------+-------------------------------------+
| Real Application PDF Components     | VERIFIED (10/10 PASS)| Independent reviewer & Playwright   |
| PDF Browser Mitigation (eval=false) | VERIFIED (8/8 PASS)  | Playwright Chromium integration     |
| PDF Library Smoke Tests             | VERIFIED (10/10 PASS)| Node/Chromium headless harness      |
| Safe Spreadsheet Parser Bounds      | VERIFIED (9/9 PASS)  | Native node:test unit runner        |
| Spreadsheet Browser Worker Isolation| VERIFIED (14/14 PASS)| Playwright (7/7) & Harness (7/7)    |
| Fail-Closed Audit Validator         | VERIFIED (12/12 PASS)| node:test regression harness        |
| Staging Environment Isolation       | VERIFIED (7/7 PASS)  | scripts/test_staging_isolation.cjs  |
| Sharp 0.35.5 Local Execution        | VERIFIED (9/9 PASS)  | Local Windows x64 test execution    |
| Sharp Linux ARM64 Compatibility     | METADATA EVIDENCE    | Vendor prebuilt specs (glibc 2.29+) |
| Nodemailer 10.3.0 Compatibility     | CODE REVIEW EVIDENCE | Official v9/v10 migration notes     |
| Nodemailer Mock SMTP Transport      | VERIFIED (9/9 PASS)  | In-process RFC 5321 SMTP loopback   |
| Transitive Overrides Runtime        | VERIFIED (9/9 PASS)  | Node loopback & parser suite        |
| Clean Disposable Installation       | VERIFIED (4/4 PASS)  | npm ci rehearsal (52.5s)            |
| Lifecycle Rehearsal & Rollback      | VERIFIED (79/79 PASS)| Rehearsal & failure vector suite    |
| Super Admin Governance & MFA        | VERIFIED (112/112)   | Playwright E2E & security suites    |
| ESLint Static Code Quality          | VERIFIED (0 ERRORS)  | npx eslint . (0 errors)             |
| Root Production Database Hash       | VERIFIED PRISTINE    | SHA-256: BF37A8...F5F1E untouched   |
+-------------------------------------+----------------------+-------------------------------------+
| Linux ARM64 Host Execution          | PENDING STAGING      | Requires run on Ubuntu aarch64      |
| PDF Chain (CVE-2024-4367) Resolution| PENDING DECISION     | Requires owner choice (Path A or B) |
| Live Secret Rotation & GitHub Gates | PENDING OPERATOR     | Requires live infrastructure action |
+-------------------------------------+----------------------+-------------------------------------+
```

### Clarified Technical Boundaries & Limitations
1. **Unpatched Underlying PDF Engine:** The runtime mitigation (`isEvalSupported: false` + dedicated Web Worker isolation) neutralizes font matrix code execution (CVE-2024-4367) across `PdfViewer.jsx`, `BulkStudentImport.jsx`, `BulkRegisteredStudentImport.jsx`, and `UploadResultsModal.jsx`. However, it does not patch potential low-level binary parser vulnerabilities in older `pdfjs-dist@3.11.174`.
2. **Audit Output:** 19 high-severity vulnerability entries remain in `npm audit --omit=dev` until `@react-pdf-viewer/core` is architecturally migrated to a maintained viewer.
3. **Web Worker Isolation Boundary:** Web Workers run within the browser JavaScript runtime and isolate CPU-heavy processing from the main UI thread (preventing UI thread lockups and isolating parsing exceptions). They do **not** provide an OS-level sandbox or security boundary against same-origin browser compromise.
4. **Platform Boundary:** Local verification was executed on Windows x64. The isolated staging rehearsal on Ubuntu 22.04 aarch64 is required to confirm native Linux ARM64 binary compatibility before production deployment.

---

## 5. Final Release Recommendation

**Maintain DEPLOYMENT STRICT NO-GO.**

Do not proceed with production deployment until:
1. The repository owner selects **Option A** (with documented risk acceptance) or **Option B** (schedule viewer migration).
2. The isolated staging plan is executed on `bfi-classroom-server` verifying Sharp, Nodemailer, and Web Worker execution on Linux aarch64 without error.
3. The operator executes live secret rotation and confirms GitHub environment review protections.
