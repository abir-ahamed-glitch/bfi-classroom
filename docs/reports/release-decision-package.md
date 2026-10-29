# BFI Classroom Release Decision Package & Staging Specification

**Date:** October 29, 2026  
**Candidate Worktree:** `.worktrees/super-admin-integration`  
**Candidate Branch:** `integration/super-admin-candidate`  
**Candidate Commit (Code & Tests):** `274bf5ba395ac8d3f8614c7f5e2f7477e4f33410`  
**Deployment Authorization Status:** **EXPLICITLY PENDING (DEPLOYMENT STRICT NO-GO)**  
**Pristine Root DB SHA-256:** `BF37A89C3F0DA1038E2E9A8FA18916D9A2986541A062C9AB40EE51E4987F5F1E`

---

## 1. Remaining PDF Viewer Choice (Plain Language Analysis)

The application currently depends on `pdfjs-dist@3.11.174` and `@react-pdf-viewer/core@3.12.0`. Upgrading `pdfjs-dist` to the patched v4+ releases is blocked because `@react-pdf-viewer/core` specifies a hard peer dependency constraint (`^2.16.105 || ^3.0.279`) and PDF.js v4 dropped CommonJS distribution, moved to pure ESM, and changed internal canvas rendering signatures.

Because of this blocker, 19 high-severity vulnerability entries remain in `npm audit` (all originating from this single viewer dependency chain, centered on CVE-2024-4367).

The system owner has two viable options:

```
+--------------------------------------------------------------------------------------------------+
| OPTION A: Temporarily Retain with Runtime Mitigation (Recommended for Controlled Staging)       |
+--------------------------------------------------------------------------------------------------+
| What it is:                                                                                      |
|   Keep pdfjs-dist@3.11.174 with isEvalSupported: false passed to getDocument() across all 4      |
|   application paths, isolated inside dedicated Web Workers.                                      |
|                                                                                                  |
| Tradeoffs:                                                                                       |
|   [+] Zero UI regressions; all 10/10 real application component tests pass immediately.         |
|   [+] Neutralizes the specific arbitrary code execution gadget (CVE-2024-4367) by disabling      |
|       dynamic Function()/eval compilation in font matrix evaluation.                             |
|   [-] 19 vulnerabilities remain in npm audit.                                                    |
|   [-] Does NOT fix any potential unpatched binary parsing flaws in the older PDF.js engine.      |
|   [-] Requires formal written risk acceptance from the repository owner.                         |
+--------------------------------------------------------------------------------------------------+
| OPTION B: Replace with Maintained, Patched Viewer Before Deployment                              |
+--------------------------------------------------------------------------------------------------+
| What it is:                                                                                      |
|   Completely remove @react-pdf-viewer and replace it with a modern PDF.js v4+ custom canvas      |
|   viewer, standard browser PDF iframe/embed integration, or PDFObject.                           |
|                                                                                                  |
| Tradeoffs:                                                                                       |
|   [+] 100% clean npm audit (all 19 remaining vulnerabilities eliminated).                       |
|   [+] Receives ongoing security updates directly from Mozilla PDF.js maintainers.                |
|   [-] Delays release; requires rewriting PdfViewer.jsx and re-verifying UI controls.             |
|   [-] Possible cross-browser styling and zoom/pan discrepancies compared to react-pdf-viewer.   |
+--------------------------------------------------------------------------------------------------+
```

### Recommendation
**Recommend Path A for immediate Linux ARM64 staging and rehearsal, coupled with a scheduled Sprint 1 follow-up migration to Path B:**
1. If the owner accepts Path A temporarily, staging and live dry-runs can proceed without code rework, because `isEvalSupported: false` and Web Worker sandboxing have been proven effective in Chromium integration tests.
2. If the owner requires a zero-vulnerability audit baseline prior to any production exposure, **Path B must be selected**, and deployment remains blocked until the viewer replacement is implemented and tested.
*(Do not assume acceptance: formal owner sign-off is mandatory).*

---

## 2. Isolated Linux ARM64 Staging Plan

**Target Host:** `bfi-classroom-server` (`129.221.243.153`, Ubuntu 22.04 LTS aarch64)  
**Strict Safety Rule:** Production files, database (`server/bfi_classroom.db`), and services (`pm2` process `bfi-classroom`, Nginx port 80/443 public routes) must remain completely untouched.

### 2.1 Staging Environment Isolation Topology
- **Isolated Directory:** `/var/www/bfi-classroom-staging`
- **Isolated Database:** `/var/www/bfi-classroom-staging/server/staging_classroom.db` (initialized via `NODE_ENV=development node server/db/database.js` or sanitized snapshot; **never** copy or symlink the live production DB).
- **Isolated Node Port:** `PORT=3002` (loopback only: `127.0.0.1:3002`)
- **Isolated Vite/Client Port:** `VITE_PORT=5175` / `VITE_BACKEND_PORT=3002`
- **Dedicated PM2 Process:** `pm2 start server/server.js --name bfi-classroom-staging`
- **Isolated Credentials:** `/var/www/bfi-classroom-staging/.env.staging` with unique random secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `MFA_ENCRYPTION_KEY`) distinct from production.

### 2.2 Step-by-Step Staging Verification Checklist

#### Step 1: Clean Installation & Prebuilt Architecture Verification
```bash
cd /var/www/bfi-classroom-staging
git checkout 274bf5ba395ac8d3f8614c7f5e2f7477e4f33410
npm ci --legacy-peer-deps
```
*Verification Check:* Confirm `@img/sharp-linux-arm64` and `@img/sharp-libvips-linux-arm64` are linked without invoking `node-gyp` or C++ compilation on Ubuntu 22.04 aarch64 (glibc 2.35).

#### Step 2: Native Sharp Execution Probe
```bash
node scripts/test_sharp_processing.cjs
```
*Verification Check:* All 9 image processing tests must pass (WebP, PNG, JPEG, resizing, corrupt input rejection). Confirm zero segmentation faults or dynamic linking errors (`libvips.so`).

#### Step 3: Local SMTP Email Generation Probe
```bash
node scripts/test_nodemailer_transport.cjs
```
*Verification Check:* All 9 transport and mock RFC 5321 SMTP loopback tests must pass with zero unhandled rejections and zero real outbound emails sent.

#### Step 4: Staging Service Initialization & Port Isolation
```bash
NODE_ENV=production PORT=3002 pm2 start server/server.js --name bfi-classroom-staging
curl -I http://127.0.0.1:3002/api/health
```
*Verification Check:* HTTP 200 OK returned on port 3002. Confirm production process (`pm2 status bfi-classroom`) on port 3001 remains unaffected with 0 restarts.

#### Step 5: Application PDF Viewing & Ingestion Checks
1. Access the staging UI via tunnel or staging subdomain (`http://127.0.0.1:3002/admin/studentsmanager`).
2. Open the "Smart Batch Import" modal and upload `tests/fixtures/pdf/valid-students.pdf`.
3. Verify that 3 student leads are extracted into the preview table.
4. Verify that the browser network tab confirms `pdf.worker.min.js` loads with HTTP 200 (no 404).
5. Attempt uploading `corrupted-header.pdf` and verify that the UI displays a clean error banner without freezing or crashing the worker.

#### Step 6: Multi-Super Admin Authentication & MFA Step-Up
1. Log in with staging Super Admin account.
2. Complete TOTP setup; scan QR code with authenticator app.
3. Test step-up verification challenge when accessing governance tabs.
4. Promote an ordinary admin to secondary Super Admin; verify audit log ledger persistence.

#### Step 7: Staging Rollback Rehearsal
```bash
node scripts/rehearse_deployment_lifecycle.cjs
node scripts/test_rollback_failures.cjs
```
*Verification Check:* Confirm 6/6 canonical lifecycle scenarios and 73/73 fail-closed vectors pass in the Linux aarch64 environment.

---

## 3. Production Operator Checklist

Prior to initiating the maintenance window on `bfi-classroom-server`, the operator must execute and verify the following steps:

### 3.1 GitHub Approval Protections (SEC-11)
- [ ] In the GitHub repository settings (**Settings > Environments**), verify the `production` environment exists.
- [ ] Verify **Required reviewers** is enabled and assigned to authorized repository maintainers.
- [ ] Verify **Deployment branches** is restricted to `main` or protected release tags.
- [ ] Confirm that `.github/workflows/deploy.yml` requires manual promotion before executing commands on the production host.

### 3.2 Secure Credential Rotation (SEC-01)
- [ ] **Do NOT generate a random `PREVIOUS_MFA_ENCRYPTION_KEY`:**
  - Copy the *currently active* key to `PREVIOUS_MFA_ENCRYPTION_KEY=<current_value>` in `.env` (or set to legacy `JWT_SECRET` if this is the initial migration).
  - Generate a single fresh 32-byte hex key for `MFA_ENCRYPTION_KEY`:
    ```bash
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    ```
  - This preserves fallback decryption in `server/utils/totp.js` so existing user authenticators remain valid.
- [ ] Generate fresh 64-character hex strings for `JWT_SECRET` and `JWT_REFRESH_SECRET` (never use `REFRESH_TOKEN_SECRET`).
- [ ] Configure dedicated transactional SMTP application password.
- [ ] Update Cloudflare Turnstile secret and site keys.
- [ ] Rehearse rotation logic on disposable test data:
  ```bash
  node scripts/rehearse_mfa_rotation.cjs
  ```

### 3.3 Maintenance Window, Backup & Rollback Boundaries
- [ ] **Approved Commit:** Confirm deployment target is pinned to verified commit `274bf5ba395ac8d3f8614c7f5e2f7477e4f33410` (or merge commit on `main`).
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

### Remaining Technical Limitations
1. **Unpatched Underlying PDF Engine:** The runtime mitigation (`isEvalSupported: false` + Web Worker isolation) neutralizes font matrix code execution (CVE-2024-4367), but does not patch low-level binary parser flaws in `pdfjs-dist@3.11.174`.
2. **Audit Output:** 19 high-severity vulnerabilities remain in `npm audit --omit=dev` until `@react-pdf-viewer` is architecturally migrated.
3. **Platform Boundary:** Local verification was executed on Windows x64; native ARM64 binaries must be verified during isolated staging on the production host.

---

## 5. Final Release Recommendation

**Maintain DEPLOYMENT STRICT NO-GO.**

Do not proceed with production deployment until:
1. The repository owner selects **Option A** (with documented risk acceptance) or **Option B** (schedule viewer migration).
2. The isolated staging plan is executed on `bfi-classroom-server` verifying Sharp and Web Worker execution on Linux aarch64.
3. The operator executes live secret rotation and confirms GitHub environment review protections.
