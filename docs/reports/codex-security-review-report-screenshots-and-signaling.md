# Security Review Response & Remediation Report: Report Screenshots & Call Signaling Hardening

**Date:** 2026-10-31  
**Target Release Reviewed:** `67845474020a4b15d6a12ce5e20fb3fbddbe9470`  
**Working Branch:** `security/report-media-and-call-signaling-hardening` (in isolated worktree `.worktrees/super-admin-integration`)  
**Auditor / Reviewer Target:** Codex  
**Status:** Verification Complete in Isolated Staging (112/112 New Assertions Passed, 47/47 Regression Assertions Passed). No changes deployed to production.

---

## 1. Executive Summary & Boundaries

Following the deployment of security release `67845474020a4b15d6a12ce5e20fb3fbddbe9470`, Codex performed a focused, read-only inspection (`docs/reports/independent-security-review-2026-10-31.md`) and identified two follow-up security concerns:
1. **High Severity:** A potential alternate public path to private report screenshots via unauthenticated `/media` and `/bfi-classroom/media` static mounts in `server/server.js`, coupled with a lack of owner/moderator authorization checks on the existing `/uploads/report-screenshots` handler.
2. **Medium Severity:** Unverified real-time call and group-call signaling in `server/server.js`, which trusted client-supplied recipient IDs, permitted signaling across arbitrary users, and lacked server-side call membership tracking.

### Operational Boundaries Maintained
- **Zero Production Mutation:** No commands were run against the live production server (`ubuntu@129.221.243.153`). Live traffic remains on commit `67845474020a4b15d6a12ce5e20fb3fbddbe9470`.
- **Zero Real User File Access:** All reproduction and verification checks utilized purely synthetic test files (`report-screenshot-10-1730389999999.png`) generated in an isolated staging workspace on port 3098.
- **Defensive Scope Only:** No exploit tooling or automated penetration scripts were developed.

---

## 2. Vulnerability Reproduction & Root Cause Analysis

### 2.1 Alternate Public Path to Report Screenshots (High)

#### Findings
1. **Unprotected Static Mounts:** `server/server.js` mounted `uploads/` statically via `express.static` at two URL prefixes:
   ```javascript
   app.use(['/bfi-classroom/media', '/media'], express.static(path.join(__dirname, '..', 'uploads'), serveStaticOptions));
   ```
   While commit `67845474020a4b15d6a12ce5e20fb3fbddbe9470` blocked `/uploads/inbox-attachments` and `/uploads/report-screenshots` at the Nginx and Express layers, the `/media` and `/bfi-classroom/media` Express mounts had an explicit block **only** for `inbox-attachments` (line 437).
2. **Direct Static Serving:** Consequently, any request directed to:
   - `/media/report-screenshots/<filename>`
   - `/bfi-classroom/media/report-screenshots/<filename>`
   bypassed authentication entirely and was served by `express.static` directly from the filesystem.
3. **Frontend Client Path Rewriting:** In `src/utils/mediaUtils.js`, `resolveMediaUrl('/uploads/report-screenshots/...')` automatically rewrote paths to `/bfi-classroom/media/report-screenshots/...`. When `src/pages/admin/Reports.jsx` fetched the screenshot with an `Authorization` header, it targeted the `/media` mount.
4. **Missing Owner / Moderator Authorization:** In PR #5, `serveReportScreenshot` executed `authenticateToken`, but contained **no check** verifying whether the authenticated user was the reporter or an administrator with report-handling privileges. Any authenticated student could fetch any report screenshot if they guessed or obtained the filename.

#### Reproduction in Isolated Staging (Pre-Fix)
Using a synthetic file `uploads/report-screenshots/report-screenshot-10-1730389999999.png`:
- `GET /media/report-screenshots/report-screenshot-10-1730389999999.png` (Unauthenticated) ➔ **HTTP 200 OK** (Disclosed file contents).
- `GET /bfi-classroom/media/report-screenshots/report-screenshot-10-1730389999999.png` (Unauthenticated) ➔ **HTTP 200 OK** (Disclosed file contents).
- `GET /uploads/report-screenshots/report-screenshot-10-1730389999999.png` (Unauthenticated) ➔ **HTTP 401 Unauthorized** (Blocked by PR #5 handler).
- `GET /uploads/report-screenshots/report-screenshot-10-1730389999999.png` (Student User 20, unrelated) ➔ **HTTP 200 OK** (Vulnerability: PR #5 lacked authorization logic).

---

### 2.2 Uploads Directory Audit

An exhaustive audit of all subdirectories under `uploads/` was conducted to determine sensitivity and access-control requirements:

| Directory | Nature / Contents | Risk Classification | Enforced Access Policy |
| :--- | :--- | :--- | :--- |
| `inbox-attachments` | Private direct messages, images, documents | **Confidential** | Blocked from all static routes (`/uploads`, `/media`, `/bfi-classroom/media`). Accessible **only** via authenticated `/api/inbox/attachments/:filename` checking conversation membership. |
| `report-screenshots` | User-submitted evidence of harassment / abuse | **Confidential** | Blocked from all static routes. Accessible across all 8 URL aliases **only** to the original reporter or admins with `reports:view` / `reports:moderate` / Super Admin. |
| `course-materials` | Educational lecture notes, syllabus files | **Semi-Public / Batch** | Publicly accessible static downloads with `Cache-Control: public` and `nosniff`. Deletions handled safely via canonical unlinking (`safe-material-cleanup.js`). |
| `certificates` | Verification credentials, graduation certificates | **Publicly Verifiable** | Publicly accessible static downloads for external credential verification. |
| `broadcast-attachments` | Public batch announcements and circulars | **Public / Cohort** | Publicly accessible static downloads for student cohorts. |

---

### 2.3 Unverified Socket.IO Call Signaling (Medium)

#### Findings
In `server/server.js`, incoming WebRTC and call signaling events were forwarded blindly:
```javascript
socket.on('call-request', (data) => {
  io.to(`user:${data.receiverId}`).emit('call-request', data);
});
socket.on('webrtc-offer', (data) => {
  io.to(`user:${data.receiverId}`).emit('webrtc-offer', data);
});
socket.on('group-call-accepted', (data) => {
  data.participantIds.forEach(pid => io.to(`user:${pid}`).emit('group-call-accepted', data));
});
```

#### Confirmed Flaws in Isolated Staging (Pre-Fix)
1. **Arbitrary 1:1 Call Signaling:** Any authenticated student could target any arbitrary `receiverId` (e.g., student from an unrelated batch, instructor, administrator), triggering unsolicited ringing modals.
2. **Orphaned / Injected WebRTC Signaling:** Users could emit `webrtc-offer`, `webrtc-answer`, and `ice-candidate` to arbitrary users without an active call session having been requested or accepted.
3. **Spoofed Group Call Metadata:** In `group-call-invite` and `group-webrtc-offer`, the payload's `callerData` and `fromId` were accepted directly from the client without server-side verification.
4. **Client-Controlled Broadcast Spraying:** In `group-call-accepted` and `group-call-left`, the server trusted the client-supplied `participantIds` array, allowing a malicious client to spam arbitrary user rooms.

---

## 3. Implemented Corrections

### 3.1 Report Screenshot Route & Static Mount Lockdown (`server/server.js`)

1. **Explicit Private Static Block:**
   Updated Express middleware to reject static access to both private directories immediately before `express.static` can evaluate:
   ```javascript
   app.use(['/bfi-classroom/media', '/media'], (req, res, next) => {
     if (req.path.startsWith('/report-screenshots') || req.path.startsWith('/inbox-attachments')) {
       return res.status(401).json({ error: 'Unauthorized access to private uploads' });
     }
     next();
   });
   ```
2. **Private Inbox Attachments 403 Hardening:**
   Expanded the 403 guard across all four URL prefixes:
   ```javascript
   app.use([
     '/media/inbox-attachments',
     '/bfi-classroom/media/inbox-attachments',
     '/uploads/inbox-attachments',
     '/bfi-classroom/uploads/inbox-attachments'
   ], (_req, res) => {
     res.status(403).json({ error: 'Private inbox attachments must be accessed via /api/inbox/attachments/:filename' });
   });
   ```
3. **Owner & Moderator Authorization Enforced (`serveReportScreenshot`):**
   - Strictly validates filename format: `/^report-screenshot-(\d+)-(\d+)\.(jpg|png|webp|gif)$/`.
   - Parses the reporter ID directly from the validated filename (`match[1]`).
   - Verifies authorization:
     - **Owner:** `user.id === reporterIdFromFilename`.
     - **Report Moderator:** `isSuperAdmin(user) || hasAnyPermission(user, 'reports:view', 'reports:moderate')`.
     - Rejects all other users with **HTTP 403 Forbidden**.
   - Sets strict Content Security Policy and download defense headers:
     ```javascript
     res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
     res.setHeader('X-Content-Type-Options', 'nosniff');
     res.setHeader('X-Frame-Options', 'DENY');
     ```
   - Uses portable root-based resolution: `res.sendFile(filename, { root: reportScreenshotsPath })`.
4. **Bound Across All 8 URL Aliases:**
   All 8 aliases are explicitly bound to `authenticateToken` followed by `serveReportScreenshot`:
   - `/uploads/report-screenshots/:filename`
   - `/uploads/report-screenshots/:filename/view`
   - `/bfi-classroom/uploads/report-screenshots/:filename`
   - `/bfi-classroom/uploads/report-screenshots/:filename/view`
   - `/media/report-screenshots/:filename`
   - `/media/report-screenshots/:filename/view`
   - `/bfi-classroom/media/report-screenshots/:filename`
   - `/bfi-classroom/media/report-screenshots/:filename/view`
5. **Fail-Safe SPA Catch-All (`serveSpaIndex`):**
   Guarded `res.sendFile(index.html)` with `fs.existsSync(indexHtml)` to prevent unhandled exceptions or misattributed 200 responses during isolated testing.

---

### 3.2 Real-Time Call Signaling Governance (`server/services/callSignalingService.js`)

A dedicated signaling service was introduced to govern all Socket.IO call events:

1. **Relational Eligibility Check (`canCommunicate`):**
   - **Administrators / Super Admins:** Permitted to communicate with any active user.
   - **Instructors:** Permitted to communicate with other instructors or students enrolled in batches they instruct.
   - **Students:** Restricted to communicating **only** with:
     - Cohort members sharing an active batch enrollment in `batch_students`.
     - Users with an established direct messaging history in `direct_messages`.
   - **Account Integrity Checks:** Strictly rejects calls to inactive accounts (`status !== 'active'`), soft-deleted accounts (`deleted_at IS NOT NULL`), and self-calling (`callerId === receiverId`).
2. **Authoritative 1:1 Session State Machine:**
   - Tracks active and pending calls in memory (`callSessions`, `userActiveCall`, `pendingCallsByCaller`).
   - `handleCallRequest`: Sanitizes `callerId` to `socket.user.id`, validates eligibility, prevents concurrent calls, and tracks pending call state with a 60-second TTL.
   - `handleCallAnswered`: Verifies the answering user matches the pending call's recipient, transitions state to `connected`, and authoritatively sets `answererId`.
   - `verifyActivePeer`: Validates that WebRTC offers, answers, and ICE candidates are exchanged **exclusively** between actively connected peers within the same verified session. Signaling from non-peers or orphaned sockets is dropped immediately.
   - `handleCallEnded` & `handleUserDisconnect`: Atomically tears down call sessions and notifies active peers with `call-ended`.
3. **Group Call Governance:**
   - `handleGroupInvite`: Verifies caller is in an active session, enforces `canCommunicate` for the invitee, and enforces a hard ceiling of 9 maximum participants per call.
   - Authoritative Participant Tracking: Discards client-supplied `participantIds` arrays; calculates `peersToNotify` authoritatively from server-side session participant sets.
   - WebRTC Disambiguation: Enforces `fromId = socket.user.id` on all group offers, answers, and ICE candidates.

---

## 4. Verification Evidence & Test Results

### 4.1 New Verification Suite (`scripts/test_media_routes_and_signaling_hardening.cjs`)
**Result: 112 / 112 Assertions Passed (100%)**

- **Suite 1: Report Screenshot Lockdown Matrix (All 8 Aliases × 6 Auth Contexts):**
  - Tested across all 8 URL aliases:
    1. Unauthenticated request ➔ **HTTP 401 Unauthorized** (File content withheld).
    2. Unrelated student request ➔ **HTTP 403 Forbidden** (File content withheld).
    3. Admin without `reports:view`/`reports:moderate` ➔ **HTTP 403 Forbidden** (File content withheld).
    4. Reporter owner request ➔ **HTTP 200 OK** (Valid file content received).
    5. Moderator admin (`reports:view`) request ➔ **HTTP 200 OK** (Valid file content received).
    6. Super Admin request ➔ **HTTP 200 OK** (Valid file content received).
  - Traversal Defense: `..` path traversal sequences rejected with 404/401.
  - Extension Whitelist: Non-whitelisted extensions (`.sh`, `.exe`) rejected with 404.
  - Static Private Attachments Guard: `/media/inbox-attachments` and `/bfi-classroom/media/inbox-attachments` return 401/403.
- **Suite 2: Socket.IO Call Signaling Governance:**
  - Negative Control 1: Student Alice attempting to call unrelated student Bob ➔ Rejected with `CALL_DISALLOWED`; Bob receives 0 events.
  - Negative Control 2: Unsolicited `webrtc-offer` without an active call session ➔ Dropped silently.
  - Negative Control 3: `group-call-invite` when caller is not in an active call ➔ Dropped silently.
  - Positive Control 1: Student Alice calling batchmate Frank ➔ `call-request` received by Frank with authoritative `callerId: 10`.
  - Positive Control 2: Frank answering call ➔ `call-answered` received by Alice with authoritative `answererId: 60`.
  - Positive Control 3: Active session WebRTC offer ➔ Successfully routed between Alice and Frank.
  - Negative Control 4: Unrelated Bob attempting to inject ICE candidate into Alice & Frank's session ➔ Dropped silently.
  - Positive Control 4: Call termination ➔ `call-ended` emitted to peer; subsequent WebRTC signaling immediately dropped.

### 4.2 Security & System Regression Suites
- **Academic Authorization & Recovery Regression (`test_academic_and_recovery_hardening.cjs`):**
  **34 / 34 PASSED (100%)**
  - Confirmed admin progress mutation authorization, phase admit/unadmit safeguards, real-time permission revocation, forgot-password enumeration defenses, and rotated refresh token rejection.
- **Deployment Defects & Tooling Regression (`test_deployment_defects_fixes.cjs`):**
  **13 / 13 PASSED (100%)**
  - Confirmed socket readiness polling, connection timeouts, and MFA secret rotation safeguards.
- **Static Analysis (ESLint):**
  `npx eslint server/server.js server/services/callSignalingService.js` ➔ **0 errors** (4 pre-existing unused variable warnings in unrelated sections).

---

## 5. Review Package & Commit Artifacts

### 5.1 Git Status & Changed Files
- **Branch:** `security/report-media-and-call-signaling-hardening`
- **Worktree:** `.worktrees/super-admin-integration`
- **Base Commit:** `67845474020a4b15d6a12ce5e20fb3fbddbe9470`
- **Modified Tracked Files:**
  - `server/server.js` (Express static route blocks, 8 alias bindings, `serveReportScreenshot` owner/moderator authorization, socket handler integration, `serveSpaIndex` fallback guard)
- **New Files Added:**
  - `server/services/callSignalingService.js` (Relational communication authorization, in-memory call session tracking, peer verification, group call governance)
  - `scripts/test_media_routes_and_signaling_hardening.cjs` (Comprehensive 112-assertion automated test suite)
  - `scripts/reproduce_security_issues.cjs` (Pre-fix reproduction script)
  - `docs/reports/codex-security-review-report-screenshots-and-signaling.md` (This report)

---

## 6. Security Limitations & Outstanding Actions

### 6.1 Explicit Boundaries & Disclaimers
- **No Claim of Platform-Wide Immunity:** These changes specifically harden report screenshot access controls across all 8 URL aliases and introduce server-side relationship validation and session tracking for real-time Socket.IO call signaling. They do not constitute a formal mathematical proof of the absence of other vulnerabilities across the application.
- **Signaling Session Persistence:** Call session states are maintained in process memory (`callSignalingService.js`). In a multi-node horizontal cluster behind a load balancer without sticky sessions or a shared Redis adapter, Socket.IO adapter clustering would be required. In the current single-instance PM2 architecture on `ubuntu@129.221.243.153`, this in-memory store is fully authoritative and robust.

### 6.2 Pre-Existing Operator Tasks (Awaiting User Execution)
As established in prior reports, the following sensitive operational actions remain pending user initiation and must not be performed via chat or unattended automation:
1. **GitHub Personal Access Token Revocation:** Revoke the previously exposed token via GitHub Developer Settings.
2. **Cloudflare Turnstile Secret Rotation:** Rotate the Turnstile secret in Cloudflare Dashboard and update the production `.env` during an authorized maintenance window.
3. **Super Admin MFA Enrollment:** Complete MFA setup securely via the web UI without exposing secrets or OTPs in chat.
4. **Test Account Containment:** Decommission legacy test accounts (2153, 2154, 2155) using schema-grounded archival.

---

## 7. Next Step & Decision
This package is complete, locally verified, and staged for review. No deployment commands will be executed until the user explicitly reviews this package and grants approval.
