# BFI Classroom Release Decision Package & Staging Specification

**Date:** October 29, 2026  
**Candidate Worktree:** `.worktrees/super-admin-integration`  
**Candidate Branch:** `integration/super-admin-candidate`  
**Application Commit (Code & Tests proposed for staging):** `e94a928213deb302ef41e0b02a9d46eea96b48fc` (short: `e94a928`)  
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

## 2. Staging Isolation Architecture & Remediation of Uncovered Defects

Iterative independent reviewer probes reproduced defects in earlier candidates `50434d6` and `8ffbae5`. All identified defects have been systematically remediated in candidate application commit `e94a928`:

### 2.1 Resolution of Specific Safety Findings

1. **Directory-Boundary-Aware Path Checks vs. Substring Collisions:**
   - *Previous Defect:* The signature check `canonicalDb.toLowerCase().includes('/var/www/bfi-classroom')` incorrectly rejected the valid documented staging directory `/var/www/bfi-classroom-staging` because the staging folder name begins with the production string.
   - *Remediation:* Replaced substring matching with `isPathWithin(child, parent)` using strict `path.relative` directory-boundary evaluation. Confirmed that `/var/www/bfi-classroom-staging/server/staging_classroom.db` is properly accepted under positive confinement while `/var/www/bfi-classroom`, `/home/ubuntu/bfi-classroom`, and sibling-prefix paths (`/var/www/bfi-classroom-staging-evil`) are strictly rejected.
2. **Mandatory Staging Secrets & Rejection of Missing Configuration:**
   - *Previous Defect:* Conflict detection only triggered when `envConfig[key]` was defined in `.env.staging`. If a staging env file omitted `JWT_SECRET`, an inherited `JWT_SECRET` from the parent environment remained active without warning.
   - *Remediation:* Explicitly defined `REQUIRED_STAGING_KEYS` (`DATABASE_PATH`, `STAGING_DATA_DIR`, `PORT`, `HOST`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MFA_ENCRYPTION_KEY`). If any required key is omitted or empty in `.env.staging`, `loadAndValidateStagingEnv` throws an immediate `SAFETY REJECTION` before any database imports or file creation, preventing inherited production secrets from silently satisfying omitted configuration. Tested missing-key vectors with and without inherited environment variables.
3. **Elimination of Credential Disclosure in Logs and Errors:**
   - *Previous Defect:* Conflict errors disclosed the first eight characters of secret keys (`substring(0, 8)`). In addition, `init_staging_db.cjs` logged the generated administrator password directly to standard output.
   - *Remediation:* Conflict error messages now report variable names only, with zero secret values or prefixes. In `init_staging_db.cjs`, stdout/stderr password disclosure has been completely removed; generated administrator credentials are written strictly to an access-controlled file (`.staging_admin_credentials.json`, mode `0600`). Regression tests assert that logs contain neither full passwords nor prefixes.
4. **Ancestor Canonicalization & Hard-Link Defenses:**
   - *Preserved Remediations:* `canonicalizePath` resolves parent symlinks and junctions for non-existent database paths prior to initialization. Positive confinement restricts database operations strictly to `STAGING_DATA_DIR`. Prohibits hard-link aliases (`stat.nlink > 1`) and compares inodes against known production database files.

---

## 3. Isolated Linux ARM64 Staging Plan

**Target Host:** `bfi-classroom-server` (`129.221.243.153`, Ubuntu 22.04 LTS aarch64)  
**Strict Safety Rule:** Production files, database (`server/bfi_classroom.db`), and services (`pm2` process `bfi-classroom`, Nginx port 80/443 public routes) must remain completely untouched. Staging authorization is strictly separate from production risk acceptance and deployment authorization.

### 3.1 Staging Environment Isolation Topology
- **Isolated Directory:** `/var/www/bfi-classroom-staging`
- **Approved Staging Data Directory:** `STAGING_DATA_DIR=/var/www/bfi-classroom-staging/server`
- **Isolated Database:** `DATABASE_PATH=/var/www/bfi-classroom-staging/server/staging_classroom.db`
- **Isolated Loopback Port:** `PORT=3002` strictly bound to `HOST=127.0.0.1` (never `0.0.0.0`)
- **Dedicated Staging Process:** `pm2 start server/staging-server.js --name bfi-classroom-staging --cwd /var/www/bfi-classroom-staging`
- **Isolated Credentials:** `/var/www/bfi-classroom-staging/.env.staging` with unique synthetic secrets.
- **Zero Outbound Services:** `EMAIL_USER=""`, `EMAIL_PASS=""`, `SMTP_PASS=""`, and `SMS_API_KEY=""` nullified in `.env.staging`; background schedulers explicitly suppressed.
- **Isolated Uploads & Logs:** Uploads directed to staging uploads directory; logs isolated to staging PM2 logs (`~/.pm2/logs/bfi-classroom-staging-*.log`).
- **Synthetic Data Only:** Staging uses dynamically generated test admin credentials (`staging-admin@bfi.local`); live production data is never copied or accessed.

### 3.2 Step-by-Step Staging Runbook for Host Operator

#### Step 1: Directory Setup & Clean Checkout
```bash
sudo mkdir -p /var/www/bfi-classroom-staging
sudo chown -R $USER:$USER /var/www/bfi-classroom-staging
cd /var/www/bfi-classroom-staging
git clone <repo_url> .
git checkout e94a928213deb302ef41e0b02a9d46eea96b48fc
```

#### Step 2: Configure Staging Environment (.env.staging)
Create `/var/www/bfi-classroom-staging/.env.staging`:
```ini
NODE_ENV=production
PORT=3002
HOST=127.0.0.1
STAGING_DATA_DIR=/var/www/bfi-classroom-staging/server
DATABASE_PATH=/var/www/bfi-classroom-staging/server/staging_classroom.db
JWT_SECRET=<random_64_hex_staging_only>
JWT_REFRESH_SECRET=<random_64_hex_staging_only>
MFA_ENCRYPTION_KEY=<random_32_hex_staging_only>
PREVIOUS_MFA_ENCRYPTION_KEY=<random_32_hex_staging_only>
EMAIL_USER=
EMAIL_PASS=
SMTP_PASS=
SMS_API_KEY=
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
*Verification Check:* Confirm `staging_guard` validates paths under positive confinement, 64 tables are created, `PRAGMA quick_check` returns OK, and synthetic user credentials are saved to `.staging_admin_credentials.json` (mode 0600) with zero credential logging to stdout.

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
2. Retrieve administrator password from `/var/www/bfi-classroom-staging/server/.staging_admin_credentials.json`.
3. Log in using `staging-admin@bfi.local`.
4. Test PDF imports in `BulkStudentImport`, `BulkRegisteredStudentImport`, and `UploadResultsModal` using test fixtures.
5. Verify browser DevTools: `pdf.worker.min.js` loads (HTTP 200), dedicated Web Worker handles parsing, and `isEvalSupported: false` is enforced.

#### Step 9: Staging Teardown & Process Cleanup
```bash
pm2 stop bfi-classroom-staging
pm2 delete bfi-classroom-staging
# (Do NOT run pm2 save; do NOT touch bfi-classroom)
```

---

## 4. Production Operator Checklist

Prior to initiating the maintenance window on `bfi-classroom-server`, the operator must execute and verify the following steps:

### 4.1 GitHub Approval Protections (SEC-11)
- [ ] In GitHub repository settings (**Settings > Environments**), verify the `production` environment exists.
- [ ] Verify **Required reviewers** is enabled and assigned to authorized repository maintainers.
- [ ] Verify **Deployment branches** is restricted to `main` or protected release tags.
- [ ] Confirm that `.github/workflows/deploy.yml` requires manual promotion before executing commands on the production host.

### 4.2 Secure Credential Rotation (SEC-01)
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

### 4.3 Maintenance Window, Backup & Rollback Boundaries
- [ ] **Approved Commit:** Confirm deployment target is pinned to verified application commit `e94a928213deb302ef41e0b02a9d46eea96b48fc` (or its clean merge commit on `main`).
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

## 5. Verification & Evidence Status Matrix

```
+--------------------------------------------------------------------------------------------------+
| LAYER / CAPABILITY                  | STATUS               | EVIDENCE SOURCE                     |
+-------------------------------------+----------------------+-------------------------------------+
| Staging Isolation & Guard Suite     | VERIFIED (16/16 PASS)| scripts/test_staging_isolation.cjs  |
| Real Application PDF Components     | VERIFIED (10/10 PASS)| Independent reviewer & Playwright   |
| PDF Browser Mitigation (eval=false) | VERIFIED (8/8 PASS)  | Playwright Chromium integration     |
| PDF Library Smoke Tests             | VERIFIED (10/10 PASS)| Node/Chromium headless harness      |
| Safe Spreadsheet Parser Bounds      | VERIFIED (9/9 PASS)  | Native node:test unit runner        |
| Spreadsheet Browser Worker Isolation| VERIFIED (14/14 PASS)| Playwright (7/7) & Harness (7/7)    |
| Fail-Closed Audit Validator         | VERIFIED (12/12 PASS)| node:test regression harness        |
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

### 5.1 Staging Isolation Regression Suite Breakdown (16/16 Tests)
All 16 tests executed in [`scripts/test_staging_isolation.cjs`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/.worktrees/super-admin-integration/scripts/test_staging_isolation.cjs) with zero failures:
1. **Rejection of `/var/www/bfi-classroom` DB path:** Non-zero exit, `SAFETY REJECTION`, file never created.
2. **Rejection of `/home/ubuntu/bfi-classroom` live checkout DB path:** Non-zero exit, `SAFETY REJECTION`, file never created.
3. **Rejection of local workspace root production database:** Non-zero exit, `SAFETY REJECTION`, root DB SHA-256 strictly untouched.
4. **Rejection of sibling-prefix directory escape (`approved-staging-evil`):** Non-zero exit, directory and DB never created.
5. **Rejection of arbitrary path outside approved staging root:** Non-zero exit, external DB never created.
6. **Rejection of real filesystem symlink/junction escape to external directory:** Non-zero exit, target DB never created.
7. **Canonicalization of existing ancestors for nonexistent DB beneath symlinked parent:** Non-zero exit, deep target never created.
8. **Rejection of hard-link alias to protected file (`nlink > 1`):** Non-zero exit, protected file untouched.
9. **Allowed exact documented staging directory structure (`/var/www/bfi-classroom-staging`):** Verified directory-boundary logic permits documented staging paths without false substring collisions.
10. **Rejection of missing `JWT_SECRET` without inherited env:** Non-zero exit, missing required key identified.
11. **Rejection of missing `JWT_SECRET` with inherited env:** Non-zero exit, proves inherited variables cannot satisfy omitted staging configuration.
12. **Rejection of blank `JWT_SECRET`:** Non-zero exit, blank string rejected.
13. **Removal of credential disclosure in conflict errors:** Asserts logs contain variable names only; zero disclosure of secret values or 8-character prefixes.
14. **Removal of administrator password disclosure in init:** Asserts stdout/stderr contain zero passwords or prefixes; credentials securely written to `.staging_admin_credentials.json` (mode 0600).
15. **Fail-closed behavior on unresolvable / relative paths:** Immediate rejection without ambiguous resolution.
16. **Valid confined staging bootstrap:** Explicit DB init (64 tables, quick_check OK), server loopback bind on `127.0.0.1:3002`, HTTP 200 on `/bfi-classroom/`, HTTP 400 on empty login, HTTP 401 without auth token, clean shutdown.

### 5.2 Remaining Untested on Linux (Must Be Verified During Isolated Host Staging)
- Native Linux aarch64 prebuilt binary execution of Sharp and libvips (`@img/sharp-linux-arm64`).
- Ubuntu Linux 22.04 LTS POSIX filesystem permissions, directory traversal, and POSIX symlinks.
- Host PM2 process management under Linux systemd.
- Live loopback binding on host port 3002.

---

## 6. Final Release Recommendation

**Maintain DEPLOYMENT STRICT NO-GO.**

Do not proceed with production deployment until:
1. The repository owner selects **Option A** (with documented risk acceptance) or **Option B** (schedule viewer migration).
2. The isolated staging plan is executed on `bfi-classroom-server` verifying Sharp, Nodemailer, and Web Worker execution on Linux aarch64 without error.
3. The operator executes live secret rotation and confirms GitHub environment review protections.
