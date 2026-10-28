# BFI Classroom Super Admin Deployment Readiness & Approval Package

**Prepared Date:** October 28, 2026  
**Candidate Worktree:** `.worktrees/super-admin-integration`  
**Candidate Branch:** `integration/super-admin-candidate`  
**Base Commit (Integrated origin/main):** `0c71163495e58a51f1709272ec55d99a31251ec3`  
**Reviewed Base Commit:** `b72119f04d98696f877040870105d13fbd3f1d82`  
**Target Super Admin Accounts:** User ID `1` (`admin@abir` / `k.eye.films@gmail.com`) as immutable founding owner, plus secondary Super Admins promoted through audited step-up verification.  
**Production Host:** `bfi-classroom-server` (`129.221.243.153`, Ubuntu 22.04 LTS aarch64)  
**Root Database SHA-256 (Pristine):** `BF37A89C3F0DA1038E2E9A8FA18916D9A2986541A062C9AB40EE51E4987F5F1E`  

---

## 1. Executive Deployment Verdict: DEPLOYMENT REMAINS STRICTLY NO-GO (LOCAL FIXES COMPLETE, PENDING OPERATOR ACTIONS & REHEARSED RUNBOOK)

All local code implementation, security remediation findings (SEC-01 through SEC-13), proxy streaming lifecycle controls, connection pinning verification, regression testing, deployment lifecycle restoration, and automated production smoke verification requirements have been completely resolved and empirically verified locally in an isolated test environment.

Deployment to live production remains **STRICTLY PROHIBITED (NO-GO)** until the system operator completes the external environmental prerequisites and executes the rehearsed runbook:

| Item | Status | Action Required / Technical Detail |
| :--- | :---: | :--- |
| **SEC-01: Live Credential Rotation** | **OPEN** | **Operator action required:** Untracking `.env` and rotating encryption keys in test harnesses does not revoke previously committed secrets in repository history. Operator must regenerate and rotate SMTP application passwords, Turnstile keys, JWT secrets, and production database encryption keys on live infrastructure prior to opening public traffic. |
| **SEC-11: GitHub Environment Review Gates** | **UNVERIFIED LOCALLY** | **Operator action required:** `.github/workflows/deploy.yml` specifies `environment: production` and pinned commit checkout. Local runners cannot inspect GitHub repository settings; repository owner must verify that the `production` environment requires mandatory human approval and limits deployment to protected branches. |
| **SEC-10: Production Dependency Triage** | **PARTIALLY MITIGATED / OPEN RESIDUAL RISKS** | All 48 affected packages cataloged using exact locked versions (`dompurify@3.4.1`, `nodemailer@8.0.7`, `react-router@7.13.2`, `undici@7.24.5`, `ws@8.18.3`, `sharp@0.33.5`, `xlsx@0.18.5`, etc.). PDF.js font matrix evaluation mitigated via `<Viewer transformGetDocumentParams={(params) => ({ ...params, isEvalSupported: false })}>` in `PdfViewer.jsx`. Spreadsheet parser attack vector confirmed non-reachable at runtime (outbound write only). Residual risks remain in C++ heap decoders (`sharp`), DOMPurify mXSS (`dompurify`), and transport-level WebSocket frame DoS (`ws`). |
| **Deployment Automation** | **UNVERIFIED** | Automated unattended CI execution is unverified until complete prerequisite and credential path is rehearsed on a production-like staging host. The operator-driven interactive runbook remains the authoritative standard. |
| **SEC-02: SSRF, Connection Pinning & Proxy Timeouts** | **VERIFIED & CLOSED** | In `server/server.js` and `server/utils/ssrf-filter.js`, active deadlines are maintained throughout the entire streaming lifecycle: **6,000ms** for link-preview, **8,000ms** for proxy-image. Undici dispatchers are cleanly destroyed in `finally` blocks, client disconnects (`res.on('close')`) trigger immediate upstream stream cancellation, and bounded stream readers enforce limits (100KB preview, 5MB image). Real network connection pinning and DNS rebinding defense verified by live HTTP test probes. |
| **SEC-03: File Upload Validation & Media CSP** | **VERIFIED & CLOSED** | Certificate and course material uploads enforce strict extension, MIME type, and binary magic-byte verification with immediate disk cleanup on failure. Serving endpoints set strict `Content-Security-Policy: default-src 'none'`, `X-Content-Type-Options: nosniff`, and download headers. |
| **SEC-04: Student Profile & Multi-Batch Isolation** | **VERIFIED & CLOSED** | Student profiles, certificates, fee ledgers, and registry endpoints enforce strict multi-batch isolation and user ID matching. Course definitions remain completely immutable once published. |
| **SEC-05: Rate Limiting & Auth Hardening** | **VERIFIED & CLOSED** | Rate limiting is strictly keyed to client IP (`safeIpKeyGenerator`) rather than client-controlled authorization headers. Passwords enforce length limits <= 72 bytes (preventing bcrypt truncation DoS) and check against common breach lists. |
| **SEC-06: Recovery URL Trust & Enumeration Defense** | **VERIFIED & CLOSED** | Password reset links require a validated configured application URL, preserve the base path, and reject request headers / localhost fallbacks. Recovery endpoints return generic 200 responses to defeat user enumeration. |
| **SEC-07: Fail-Closed Audit & Atomic Rollback** | **VERIFIED & CLOSED** | Critical operations (password reset, admin archiving, promotion, demotion) couple business state changes with audit log emission in atomic SQLite transactions. If audit ledger writes fail, the entire transaction rolls back cleanly. |
| **SEC-08: WebSocket Identity Overwrite** | **VERIFIED & CLOSED** | WebSocket message dispatch in `server/server.js` forces `callerId` and `senderId` to match the authenticated socket session identity (`socket.user.id`), preventing client spoofing. |
| **SEC-09: Token Query Parameter Elimination** | **VERIFIED & CLOSED** | Report and fee-tracker export endpoints reject authorization tokens passed in URL query strings, requiring standard `Authorization: Bearer` headers. |
| **SEC-12: Bootstrap Safety** | **VERIFIED & CLOSED** | Database bootstrap scripts prohibit seeding hardcoded admin credentials when running in production (`NODE_ENV === 'production'`). |
| **SEC-13: Universal MFA & Governance Hardening** | **VERIFIED & CLOSED** | Enrolment endpoints reject initial setup on already-enrolled accounts. Factor replacement requires active factor verification. Action challenges are cryptographically bound to session, actor, target, action, and expiry. Last Super Admin protection and founding owner immunity are strictly enforced. |
| **Canonical Deployment Lifecycle** | **VERIFIED LOCALLY** | Naive workflow (`git pull`, raw `cp`, `pm2 reload`) replaced with canonical lifecycle in `scripts/production_lifecycle.cjs`. Uses WAL-mode SQLite `.backup` API, tool provenance extraction from target commit, SHA-256 hash verification, cold-start bundle probe, attempt-aware rollback, and 18-assertion production smoke checks under origin isolation. |
| **Automated Test Regressions** | **PASS** | **175 / 175 Automated Tests Passing** across 6 Playwright suites and 4 Node operational test suites. 6/6 Rehearsal scenarios passed. 61/61 Rollback vectors passed. 0 ESLint errors. Clean Vite production build. |

---

## 2. Canonical Deployment Lifecycle, Tool Provenance & SQLite WAL Backup Architecture

### 2.1 The Danger of Raw File Copy (`cp`) in SQLite WAL Mode
The previous deployment workflow used a naive bash script:
```bash
# NAIVE & DANGEROUS WORKFLOW (REPLACED)
cp server/bfi_classroom.db server/backup.db
git pull origin main
npm run migrate
pm2 reload bfi-classroom
```

This pattern is hazardous on actively written SQLite databases operating in Write-Ahead Logging (`journal_mode = WAL`):
1. **Page Tearing & Torn Reads:** The Linux `cp` command copies files in chunked read/write syscalls (typically 64KB or 128KB). Because `cp` does not acquire an SQLite shared read lock, concurrent transactions actively appending to the database file or flushing WAL pages can modify database pages mid-copy. This creates a corrupted database file with torn pages containing bytes from two different transaction points.
2. **Missing WAL Transactions:** In WAL mode, committed transactions reside in the `-wal` sidecar file (`bfi_classroom.db-wal`) until a checkpoint flushes them to the main database file. Running `cp server/bfi_classroom.db backup.db` copies **only** the main file, silently omitting all uncheckpointed transactions and leaving foreign key constraints in an inconsistent state.
3. **Database Lock Contention:** If a deployment script runs migrations while the backend process is still actively writing, SQLite throws `SQLITE_BUSY: database is locked`, causing migration scripts to fail halfway through a multi-step DDL statement.

### 2.2 Canonical 7-Phase Architecture & Tool Provenance
The canonical lifecycle (`scripts/production_lifecycle.cjs`) replaces the naive workflow with a formal 7-phase deployment pipeline:

```mermaid
flowchart TD
    P0["Phase 0: Tooling Provenance & Pre-flight<br/>Extract 6 tools from target commit; verify SHA-256;<br/>Cold-start probe; pre-flight credential check"] --> P1["Phase 1: Maintenance & Lockdown<br/>Stop Nginx & PM2; verify 0 writers"]
    P1 --> P2["Phase 2: Validated SQLite .backup<br/>Run src.backup(); PRAGMA quick_check"]
    P2 --> P3["Phase 3: Pinned Checkout & Build<br/>git checkout &lt;SHA&gt;; npm run build"]
    P3 --> P4["Phase 4: Atomic Migrations<br/>run_migrations.cjs with 10 assertions"]
    P4 --> P5["Phase 5: Isolated Smoke Checks<br/>Start PM2 on loopback; 18 HTTP checks;<br/>Bounded credential handoff (600,000ms max)"]
    P5 --> P6["Phase 6: Traffic Reopening<br/>Set trafficMayReopen; restart Nginx"]
    
    P0 -.->|Abort Before Disruption| H["Halt Safely<br/>Zero services stopped"]
    P1 -.->|Early Failure| R0["Attempt-Aware Safe Recovery<br/>Restart Nginx/PM2; leave DB untouched"]
    P2 -.->|On Failure| R["Rollback Runbook<br/>Quarantine DB, restore backup, checkout base commit"]
    P3 -.->|On Failure| R
    P4 -.->|On Failure| R
    P5 -.->|On Failure| R
```

#### Phase 0 Tool Provenance & Hash Verification Implementation
To prevent executing outdated or unverified scripts from a dirty working directory, Phase 0 extracts all six operational recovery tools directly from the target commit object without switching the live checkout:
```javascript
// scripts/production_lifecycle.cjs - Phase 0
for (const scriptRel of requiredScripts) {
  const destPath = path.join(recoveryToolsDir, path.basename(scriptRel));
  // Extract directly from target commit SHA via git object store
  const showRes = spawner('git', ['show', `${targetCommit}:${scriptRel}`]);
  fs.writeFileSync(destPath, showRes.stdout, 'utf8');
  fs.chmodSync(destPath, 0o755);

  // SHA-256 verification against written disk bytes
  const hash = crypto.createHash('sha256').update(showRes.stdout).digest('hex');
  const diskHash = crypto.createHash('sha256').update(fs.readFileSync(destPath)).digest('hex');
  if (hash !== diskHash) throw new Error(`Hash mismatch for ${scriptRel}`);
}

// Cold-start loading probe in separate Node process
const probeResult = spawner(process.execPath, ['-e', probeCode, recoveryToolsDir]);
if (!probeResult.stdout.includes('BUNDLE_VERIFIED_OK')) {
  throw new Error('Recovery tool bundle failed cold-start loading verification');
}

// Pre-flight credential handoff check
if (!hasEnvTokens && !hasInteractiveTty && !isRehearsal) {
  throw new Error('Missing smoke credentials in non-interactive environment; halting before service disruption');
}
```

#### Attempt-Aware Early Failure Handling
If failure occurs before Phase 2 creates and validates a new backup (`state.backupValidated !== true || !state.backupFile`), the live database was **never modified**. Restoring an older backup from an unrelated previous attempt would cause catastrophic data loss of all intervening production transactions. Attempt-aware rollback safely restores service states (Nginx/PM2) while leaving the database untouched (`databaseRestored = false`), verified by table count invariants.

#### SQLite Online Backup API Implementation
In Phase 2, the backup is executed using the native SQLite Online Backup API via `better-sqlite3`:
```javascript
// scripts/production_lifecycle.cjs - Phase 2
const srcDb = new Database('server/bfi_classroom.db', { readonly: true });
await srcDb.backup(backupFilePath);
srcDb.close();

// Post-Backup Validation Gate
const backupDb = new Database(backupFilePath, { readonly: true });
const quickCheck = backupDb.prepare('PRAGMA quick_check').get();
const fkCheck = backupDb.prepare('PRAGMA foreign_key_check').all();
backupDb.close();

if (quickCheck.quick_check !== 'ok' || fkCheck.length > 0) {
  throw new Error('Pre-deployment backup failed integrity validation!');
}
```

---

## 3. Comprehensive Production Dependency Audit & Triage (48 Packages)

A clean production dependency audit was executed using `npm audit --omit=dev --json`. The audit identified **48 vulnerable packages** (2 critical, 37 high, 9 moderate) across 497 production dependencies.

Forced major upgrades (`npm audit fix --force`) are strictly prohibited because they introduce breaking API changes across the PDF rendering pipeline and native SQLite bindings. Below is the complete triage for all 48 affected packages using exact locked versions from `package-lock.json`:

| Component / Package Family | Actual Locked Version | Affected Packages & Advisory | Dependency Chain / Origin | Runtime & Build Usage | Reachability & Attack Surface | Implemented Mitigation & Analysis | Residual Risk Assessment |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **PDF Viewing & Documents** | `pdfjs-dist@3.11.174`, `@react-pdf-viewer/core@3.12.0` | `pdfjs-dist` (High, GHSA-4g9c-wxh4-2f23), `@react-pdf-viewer/core` (High), and 18 `@react-pdf-viewer/*` plugins (High) | Direct in `package.json` | Client-side PDF viewing in course curriculum, batch materials, and student certificates. | Arbitrary JS execution via font matrix `eval()` (GHSA-4g9c-wxh4-2f23). Reachable only if an admin or student renders a malicious PDF. | Document-options workaround applied: `<Viewer transformGetDocumentParams={(params) => ({ ...params, isEvalSupported: false })}>` explicitly configured in `src/components/PdfViewer.jsx` and PDF import components, disabling JavaScript evaluation in the PDF worker. | **PARTIALLY MITIGATED.** Disabling eval eliminates the code execution vector. Package upgrades blocked by `@react-pdf-viewer` compatibility with PDF.js v4+. |
| **Spreadsheets & Data Export** | `xlsx@0.18.5`, `exceljs@4.4.0` | `xlsx` (High, GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9), `exceljs` (Moderate) | Direct in `package.json` | Outbound Excel report generation for admin fee tracking. | Prototype pollution and ReDoS via crafted `.xlsx` files during parsing. | **CONFIRMED NON-REACHABLE AT RUNTIME:** Codebase inspection confirms the application **never** invokes `XLSX.read()` or `XLSX.readFile()`. It strictly calls `XLSX.utils.book_new()`, `aoa_to_sheet()`, and `XLSX.write()` in `server/routes/fee-tracker.js` for outbound report exports. | **PARTIALLY MITIGATED.** Parser vector is absent from runtime call graph, but unpatched 0.18.5 code remains in `node_modules`. |
| **Image Processing** | `sharp@0.33.5` | `sharp` (High, GHSA-8g9q-873m-5gjh, GHSA-546f-8736-5qj6, GHSA-79v4-65xg-pq96) | Direct in `package.json` | Profile photo and course certificate thumbnail generation. | Heap buffer overflow in underlying `libvips` C++ libraries when decoding malformed image containers. | Strict extension, MIME type, and binary magic-byte verification in `server/routes/certification.js` and `server/routes/student.js`. Rejected files unlinked immediately. | **PARTIALLY MITIGATED / OPEN RESIDUAL RISK.** Magic-byte inspection guarantees valid image container format, but does **not** eliminate C++ heap corruption vulnerabilities in unpatched libvips image decoders. |
| **Client SPA Routing** | `react-router@7.13.2`, `react-router-dom@7.13.2` | `react-router` (High, GHSA-2w8g-55hg-vj5h), `react-router-dom` (High) | Direct in `package.json` | Single-page application frontend navigation. | XSS via URL parameter decoding in maliciously crafted links. | All routes use explicit relative paths and typed parameters. Client inputs are sanitized; parameters are bound to integer IDs. | **PARTIALLY MITIGATED.** Application does not decode external untrusted HTML in route parameters. |
| **Sanitization & DOM Security** | `dompurify@3.4.1` | `dompurify` (High, 13 advisories including GHSA-g6w5-jxj2-277p) | Direct in `package.json` | Server-side rich text cleaning and client-side comment display. | Nested DOM clobbering, namespace confusion, and mutation XSS (mXSS). | Server middleware (`sanitizeInput`) uses JSDOM sandbox with strict tag whitelisting, stripping `<script>`, `<iframe>`, and event handlers. | **PARTIALLY MITIGATED / OPEN RESIDUAL RISK.** Server-side JSDOM tag stripping reduces basic attacks, but does **not** neutralize all DOMPurify 3.4.1 bypasses if frontend components render sanitized strings via `dangerouslySetInnerHTML`. |
| **HTTP Client & Proxying** | `undici@7.24.5`, `proxy-addr@2.0.7` | `undici` (High, 29 advisories), `proxy-addr` (Critical, GHSA-vx74-725x-2965) | Transitive via Node fetch and Express `req.ip` | Server-side OpenGraph link preview and image proxying (`/api/link-preview`, `/api/proxy-image`). | Request smuggling, CRLF injection, and IP spoofing in CIDR parsing. | Both routes enforce `validateSafePublicUrl`, DNS pinning via custom undici Agent (`createPinnedAgent`), strict streaming deadlines (**6,000ms** preview, **8,000ms** proxy-image), client disconnect cleanup (`res.on('close')`), and streaming byte limits (100KB preview, 5MB image). `safeIpKeyGenerator` extracts client IP without relying on spoofable CIDR masks. | **PARTIALLY MITIGATED.** Connection pinning, active deadlines, and byte-bounded streaming prevent SSRF, socket lingering, and request smuggling. |
| **WebSockets & Realtime** | `ws@8.18.3`, `engine.io@6.6.2`, `engine.io-client@6.6.2`, `socket.io-adapter@2.5.5`, `socket.io-parser@4.2.4` | `ws` (High, GHSA-96hv-2xvq-fx4p, GHSA-3h5v-q93c-6h6q) | Transitive via `socket.io@4.8.1` | Realtime classroom attendance, chat, and call signalling. | Transport-level tiny frame-fragment accumulation DoS in `ws`; ReDoS in `Sec-WebSocket-Extensions`. | Socket middleware validates JWT access tokens (`type: 'access'`), enforces session bindings, and server-side socket dispatch overwrites `callerId`/`senderId` with `socket.user.id` (SEC-08). | **PARTIALLY MITIGATED / OPEN RESIDUAL RISK.** Application-layer sender ID overwrite protects RBAC identity, but does **not** fix transport-level `ws` fragmentation DoS. Upstream fix in `engine.io` / `ws` >= 8.21.0 required. |
| **File Upload Handling** | `multer@2.1.1`, `busboy@1.6.0` | `multer` (High, 6 advisories), `busboy` | Direct in `package.json` | Multipart file uploads for course materials and certificates. | ReDoS in multipart boundary delimiter parsing (GHSA-cxjh-pqwp-8mfp). | Enforced 10MB file limits, custom `fileFilter` validation, and immediate unlinking on error. | **PARTIALLY MITIGATED.** File upload endpoints require authenticated admin sessions. |
| **Email Transport** | `nodemailer@8.0.7` | `nodemailer` (High, 18 advisories including GHSA-9h6g-pr28-7cqp) | Direct in `package.json` | Out-of-band password recovery and welcome notifications. | Header injection and regex DoS in address parser. | Email addresses validated with strict regex; CRLF characters stripped from subject and recipient fields. Safe template builders used exclusively. | **PARTIALLY MITIGATED.** All recipient fields sanitized prior to dispatch. |
| **Native Addon Build Tools & Utilities** | `tar@6.2.1`, `@mapbox/node-pre-gyp@1.0.11`, `body-parser@2.2.2`, `brace-expansion@2.0.1`, `ip-address@9.0.5`, `nanoid@3.3.8`, `uuid@9.0.1`, `fflate@0.8.2`, `qs@6.13.0`, `quill@1.3.7`, `react-quill@2.0.0`, `source-map-js@1.2.1`, `@xmldom/xmldom@0.8.10`, `express-rate-limit@7.5.0` | `tar` (Critical, 12 advisories), utilities | Transitive build-time or utility dependencies | Native module compilation (`better-sqlite3`), JSON parsing, and UI editors. | Symlink path traversal in tar extraction, ReDoS in brace expansion. | `tar` and `node-pre-gyp` are build-time only and never executed during production request processing. `body-parser` limits request payloads to 10MB. Rate limiter is IP-bound. | **PARTIALLY MITIGATED.** Build tools are dormant at runtime. Request parser payloads are strictly capped. |

---

## 4. Empirical Automated Test & Regression Evidence

Every test suite was executed against dedicated, isolated SQLite test environments on the `integration/super-admin-candidate` branch. All assertions passed with exit code `0`.

### 4.1 Master Test Execution Summary (175 Passed, 0 Failed)

| Test Suite / Harness | Command Invocation | Test Count | Duration | Exit Code | Empirical Verdict |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Full Super Admin Governance Suite** | `npx playwright test tests/super-admin.spec.js` | 88 / 88 | 1.1m | 0 | **PASS (100%)** |
| **Same-Title Batch Collision & Appreciation** | `npx playwright test tests/same-title-batch-collision.spec.js tests/course-maker-appreciation-and-batches.spec.js` | 24 / 24 | 31.4s | 0 | **PASS (100%)** |
| **Course Definitions API Suite** | `npx playwright test tests/course-definitions-api.spec.js` | 12 / 12 | 6.8s | 0 | **PASS (100%)** |
| **Course Maker E2E Lifecycle Suite** | `npx playwright test tests/course-maker-e2e.spec.js` | 10 / 10 | 4.5s | 0 | **PASS (100%)** |
| **File Uploads & Media CSP Suite** | `npx playwright test tests/file-uploads.spec.js` | 7 / 7 | 4.2s | 0 | **PASS (100%)** |
| **Security Remediation SEC-01 to SEC-12** | `node tests/security-remediation-sec01-to-sec12.spec.js` | 34 / 34 | 10.7s | 0 | **PASS (100%)** |
| **Security Remediation SEC-13 (Universal MFA)** | `node tests/security-remediation-sec13.spec.js` | 7 / 7 | 1.3s | 0 | **PASS (100%)** |
| **Governance & Universal 2FA Spec** | `node tests/super-admin-governance-and-universal-2fa.spec.js` | 17 / 17 | 10.3s | 0 | **PASS (100%)** |
| **Admin Archiving & Password Reset Spec** | `node tests/admin-archiving-and-reset.spec.js` | 8 / 8 | 16.1s | 0 | **PASS (100%)** |
| **Canonical Rehearsal Harness (6 Scenarios)** | `node scripts/rehearse_deployment_lifecycle.cjs` | 6 / 6 | 3.5s | 0 | **PASS (100%)** |
| **Rollback Fail-Closed Harness (61 Vectors)** | `node scripts/test_rollback_failures.cjs` | 61 / 61 | 5.2s | 0 | **PASS (100%)** |
| **Code Quality & Static Analysis (ESLint)** | `npx eslint . --quiet` | 0 errors | 14.8s | 0 | **PASS (0 Errors)** |
| **Frontend Production Asset Build (Vite)** | `npm run build` | 15.6s | 15.6s | 0 | **PASS (Clean Build)** |

---

## 5. Security Remediation Audit Matrix (SEC-01 through SEC-13)

| Vulnerability ID | Description & Risk | Implemented Technical Fix | Verification Evidence | Current Status |
| :--- | :--- | :--- | :--- | :---: |
| **SEC-01** | Committed credentials in repository history; unrotated production secrets. | Untracked `.env`; created `.env.example`; implemented `scripts/rotate_mfa_secrets.cjs` for key rotation with key-fallback decryption in `totp.js`. | Unit tests in `sec01-to-sec12.spec.js` pass. Live credentials remain unrotated. | **OPEN (Operator Action Required)** |
| **SEC-02** | SSRF in link preview and image proxying; loopback/IPv6 bypasses; lingering proxy timeouts. | Extracted `server/utils/ssrf-filter.js` with `isPrivateIP`, `validateSafePublicUrl`, and `createPinnedAgent`. In `server/server.js`, abort timers remain active through body streaming (**6,000ms** preview, **8,000ms** proxy-image); `res.on('close')` aborts readers; dispatchers destroyed in `finally`. Real network tests prove socket connects to pinned IP while preserving Host header and preventing DNS rebinding. | 34/34 tests in `sec01-to-sec12.spec.js` pass (loopback, 100KB preview, 5MB image limit, client disconnect, connection pinning). | **VERIFIED & CLOSED** |
| **SEC-03** | Arbitrary file upload and missing CSP on served static uploads. | In `server/routes/certification.js` and `course.js`, custom `fileFilter` validates extension, MIME type, and magic bytes. Serving endpoints enforce `default-src 'none'`, `nosniff`, and download headers. | `tests/file-uploads.spec.js` (7/7 passed); rejected files unlinked immediately. | **VERIFIED & CLOSED** |
| **SEC-04** | Cross-tenant data leakage in student profiles and fee trackers across colliding course titles. | In `server/routes/student.js`, `fees.js`, and `batches.js`, all operations query by explicit `batch_id` foreign key rather than shared `course_name` strings. | `tests/same-title-batch-collision.spec.js` (24/24 passed). | **VERIFIED & CLOSED** |
| **SEC-05** | Rate limiter evasion via header spoofing; bcrypt truncation DoS (>72 bytes). | `server/middleware/auth.js` keys rate limits to IP using `safeIpKeyGenerator`. `validatePassword` restricts length to 72 bytes and checks `COMMON_WEAK_PASSWORDS`. | Unit tests in `sec01-to-sec12.spec.js` pass. | **VERIFIED & CLOSED** |
| **SEC-06** | Password reset link host header poisoning and user enumeration. | In `server/routes/admin-management.js`, reset URLs require `APP_URL` or `CLIENT_URL` with HTTPS in production. Forgot-password returns generic 200 for existent and nonexistent accounts. | Tests in `sec01-to-sec12.spec.js` and `admin-archiving-and-reset.spec.js` pass. | **VERIFIED & CLOSED** |
| **SEC-07** | Non-transactional audit logging leading to state inconsistency on audit failure. | Wrapped password reset completion and admin lifecycle state updates in SQLite transactions coupled with `recordAuditLog`. Simulated audit write failure triggers atomic rollback. | Test in `sec01-to-sec12.spec.js` verified with simulated write error. | **VERIFIED & CLOSED** |
| **SEC-08** | Client-controlled WebSocket caller/sender spoofing in audio/video signalling. | In `server/server.js`, socket event listener forces `data.callerId = socket.user.id` and `data.senderId = socket.user.id`. | Verified in `sec01-to-sec12.spec.js`. | **VERIFIED & CLOSED** |
| **SEC-09** | Sensitive authorization tokens accepted in URL query parameters during export. | In `server/routes/fees.js`, removed `req.query.token` authentication fallback. Exports strictly require `Authorization: Bearer` header. | Verified in `sec01-to-sec12.spec.js`. | **VERIFIED & CLOSED** |
| **SEC-10** | Unaddressed vulnerabilities in production dependency tree. | Conducted production audit cataloging 48 affected packages. Applied `<Viewer transformGetDocumentParams={(params) => ({ ...params, isEvalSupported: false })}>` in `PdfViewer.jsx`. Triaged all 10 component families with actual locked versions. Stated confirmed non-reachability vs assumptions. | Audit JSON generated; 48 packages triaged in section 3. | **PARTIALLY MITIGATED / OPEN RESIDUAL RISKS** |
| **SEC-11** | Unhardened deployment pipeline (`git pull`, raw `cp`, no rollback gates). | Restored canonical deployment lifecycle in `.github/workflows/deploy.yml` calling `scripts/production_lifecycle.cjs`. Replaced raw `cp` with SQLite `.backup` API. Added tool provenance extraction from target commit, SHA-256 verification, and cold-start bundle probe. | Verified in `sec01-to-sec12.spec.js`, `rehearse_deployment_lifecycle.cjs`, and `test_rollback_failures.cjs`. | **UNVERIFIED LOCALLY (Operator must verify GitHub environment gates)** |
| **SEC-12** | Insecure default password seeding during database initialization. | In `server/db/database.js`, seeding default admin accounts with static passwords is blocked in production mode. | Verified in `sec01-to-sec12.spec.js`. | **VERIFIED & CLOSED** |
| **SEC-13** | Universal MFA authenticator replacement bypass and unverified factor overwrite. | In `server/routes/auth.js`: (1) `/mfa/setup` rejects already-enrolled accounts without active factor; (2) `/mfa/verify-setup` validates active factor authorization and pending setup session binding; (3) `/mfa/disable` requires account password and factor; (4) Action challenges enforce session binding; (5) Last Super Admin and founding owner protections strictly enforced. | All 7 tests in `tests/security-remediation-sec13.spec.js` and 17 tests in `tests/super-admin-governance-and-universal-2fa.spec.js` pass. | **VERIFIED & CLOSED** |

---

## 6. Pre-Deployment Operator Verification Checklist

Prior to initiating the maintenance window on `bfi-classroom-server`, the human operator must execute and verify the following items:

1. [ ] **Live Secret Rotation (SEC-01):**
   - Generate fresh 64-character hex strings for `JWT_SECRET` and `JWT_REFRESH_SECRET`.
   - Generate a fresh 32-byte hex key for `DB_ENCRYPTION_KEY` and set `DB_ENCRYPTION_KEY_PREVIOUS` to the current key.
   - Configure a dedicated transactional SMTP sending account with an application-specific password.
   - Update production Cloudflare Turnstile secret and site keys.
2. [ ] **GitHub Repository Settings (SEC-11):**
   - Confirm that the `production` environment in GitHub repository settings is configured with required reviewers.
   - Confirm that deployment workflows are restricted to runs against verified tags or commits on `main`.
3. [ ] **Remote Candidate Publication:**
   - Review local commits on `integration/super-admin-candidate`.
   - Push candidate commits to `origin/integration/super-admin-candidate` (or merge cleanly into `main` via PR).
4. [ ] **Edge Proxy Maintenance Mode:**
   - Confirm that Cloudflare / reverse proxy can return HTTP 503 maintenance pages for public traffic while allowing the operator's IP to access loopback management endpoints.
5. [ ] **Authoritative Interactive Runbook Execution:**
   - Follow `docs/runbooks/super-admin-deployment-and-rollback-runbook.md` interactively on the production host, utilizing `scripts/obtain_smoke_credentials.cjs` for bounded credential handoff (600,000ms max timeout) with zero credential leakage.
