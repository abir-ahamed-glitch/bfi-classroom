# Architectural Design Specification: Admin Archiving, Accountability Ledger & Super Admin-Initiated Password Reset

**Document Status:** Revised for User Approval (v2)  
**Date:** 2026-10-28  
**Workspace:** `E:\Antigravity\Project 2 - BFI Classroom\.worktrees\super-admin-integration`  
**Target Branch:** `integration/super-admin-candidate`  
**Author:** Antigravity Engineering (Superpowers Architectural Workflow)

---

## 1. Executive Summary & Purpose

This specification defines the architectural design, security controls, database schema extensions, and interface contracts for two interrelated subsystems in **BFI Classroom**:
1. **Admin Archiving & Preserved Accountability History**: Moving former administrators out of active administration without deleting account identities, audit history, creator attribution, or dependent business records (students, batches, courses, payments).
2. **Super Admin-Initiated Administrator Password Reset**: Enabling the Super Admin to initiate a controlled, single-use, 30-minute expiring password reset for an administrator, with a persistent reset-pending state that blocks all system access until password replacement is completed.

### Strict Non-Destructive Principles
- **Decision Locked:** "Archive Admin instead of permanently deleting the account".
- **Zero Data Loss:** Archiving an administrator does not delete, cascade-delete, truncate, or reassign any student, course, payment, assignment, notice, broadcast, or audit records.
- **Historical Honesty:** The system preserves existing history as recorded. Past periods prior to modular audit logging will accurately display `"Unknown/Legacy"`; no artificial records are fabricated.
- **No Disposal in this Release:** No "Clear History" buttons, automated purges, or history deletion routines are included in this release.

---

## 2. Verified Baseline & Existing Controls Analysis

A deep architectural inspection of the codebase in `server/` was conducted to ground this design in verified reality:

### 2.1 Password Policy
*Source:* `server/middleware/auth.js:382-386`
```javascript
export function validatePassword(password) {
  // Min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
  const re = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return re.test(password);
}
```
*Design Constraint:* All password replacement endpoints (including admin reset) strictly enforce this exact regex.

### 2.2 Sensitive-Action Verification (Sudo Mode)
*Source:* `server/middleware/auth.js:417-481`
- `requireRecentAuth` validates that the administrator has verified their **account password** within the preceding **15 minutes** bound strictly to the active session (`sessions.sudo_verified_at`), or provided an inline `x-sudo-password`/`req.body.sudo_password`, or an `x-sudo-token` JWT.
- **Explicit Clarification of Capability:** `requireRecentAuth` checks password verification only. **It does NOT challenge for or verify a fresh TOTP/MFA code for individual sensitive actions.** The design makes no claim of MFA-backed sudo verification; sensitive administrative actions require Super Admin password re-verification.
- If unverified, returns HTTP 428 Precondition Required (`code: 'SUDO_REQUIRED'`, `requireSudo: true`).
*Design Constraint:* Archiving, Restoring, Password Reset Initiation, and History Export strictly require `requireRecentAuth`.

### 2.3 Recovery Email Mechanism Reality & Ownership Verification
*Source:* `server/db/database.js:38-56` (`users` schema) & `server/routes/admin-management.js:1099-1145`
- The `users` table contains `email TEXT UNIQUE NOT NULL`, but **has no `email_verified` or `email_verified_at` column**.
- Admin emails are assigned directly by Super Admin upon creation and validated only via regex `validateEmail(email)`. No verification email handshake exists in BFI Classroom.
- **Zero-Assumption Rule:** Super Admin clicking "confirm" does **not** cryptographically verify mailbox ownership. Sending credentials or reset tokens to an unproven address risks account takeover or credential leakage if a typo was made.
- **Explicit Email Ownership Verification Flow:**
  - Introduce `users.email_verified_at TEXT DEFAULT NULL`.
  - An address is considered verified **only** if `email_verified_at IS NOT NULL`.
  - An email verification challenge (signed 24-hour verification token) is dispatched to the administrator's email. When the recipient visits the link, `email_verified_at = datetime('now')` is set.
  - **No Automatic Reset Dispatch to Unverified Addresses:** If `targetUser.email_verified_at IS NULL`, the server rejects email reset dispatch with HTTP 400 `EMAIL_NOT_VERIFIED`.
- **Manual Delivery as a Separate, Explicit Recovery Mode:**
  - Manual out-of-band delivery is **NOT** an automatic fallback after SMTP failure.
  - It is an explicit, separately chosen recovery option ("Generate Out-of-Band Single-Use Link") that Super Admin must intentionally select when:
    a) The administrator's email is unverified, OR
    b) Super Admin explicitly opts for physical/in-person or secure out-of-band delivery.
  - Requires explicit Super Admin justification, password re-verification (`requireRecentAuth`), and is logged in the audit ledger under a dedicated action: `admin.generate_direct_reset_link`.

### 2.4 Critical Email Credential Security Notice
*Source:* `server/utils/email.js:6-7`
- **Security Finding:** `server/utils/email.js` contains a hard-coded fallback SMTP username and application password directly in the source code.
- **Security Policy:**
  1. Antigravity will **never** print, copy, or expose this credential in any chat response, plan, or specification.
  2. The proposed implementation will completely strip the hard-coded fallback from `server/utils/email.js` and mandate protected environment variables:
     ```javascript
     const user = process.env.EMAIL_USER?.trim();
     const pass = process.env.EMAIL_PASS?.replace(/\s+/g, '');
     if (!user || !pass) {
       return null; // SMTP unconfigured
     }
     ```
  3. **Operator Action Required:** The authorized operator must immediately rotate this credential in Google Workspace / Gmail and configure it strictly inside the server's protected `.env` file. The agent will not alter production environment variables or credentials.
- **Email Copy & Accuracy:**
  - Update email subject: `Administrative Password Reset - BFI Classroom`.
  - Update body copy: Describe the action clearly as a **Super Admin-initiated administrative reset** (not a user self-service request).
  - Update expiry: Accurately state that the link is valid for **30 minutes** (correcting the outdated 15-minute text).

### 2.5 Token Version, Session Invalidation & Sockets
*Source:* `server/middleware/auth.js:84-101`, `server/routes/auth.js:812-815`, `server/server.js:547-582`
- Privileged administrators are bound to `token_version` on `users` and active `sessions` records.
- Session revocation requires:
  1. `UPDATE users SET token_version = token_version + 1 WHERE id = ?`
  2. `DELETE FROM sessions WHERE user_id = ?`
  3. `UPDATE mfa_login_challenges SET consumed = 1 WHERE user_id = ?`
  4. `securityEvents.emit('revoke_user', { userId })` (disconnects Socket.io connections immediately).

---

## 3. Database Schema Extensions & Migration Specification

A new migration `server/db/migrations/20261028_admin_archiving_and_reset.cjs` will be executed within an atomic SQLite transaction, tracked in `app_migrations`.

### 3.1 Alterations to `users` Table
```sql
-- Archive lifecycle tracking
ALTER TABLE users ADD COLUMN archived_at TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN archived_by_admin_id INTEGER REFERENCES users(id) DEFAULT NULL;
ALTER TABLE users ADD COLUMN archive_reason TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN restored_at TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN restored_by_admin_id INTEGER REFERENCES users(id) DEFAULT NULL;
ALTER TABLE users ADD COLUMN restore_reason TEXT DEFAULT NULL;

-- Email ownership verification
ALTER TABLE users ADD COLUMN email_verified_at TEXT DEFAULT NULL;

-- Persistent password reset pending state
ALTER TABLE users ADD COLUMN password_reset_pending INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN password_reset_requested_at TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN password_reset_requested_by INTEGER REFERENCES users(id) DEFAULT NULL;

-- Mandatory account versioning for optimistic concurrency protection
ALTER TABLE users ADD COLUMN account_version INTEGER NOT NULL DEFAULT 1;

-- Performant indexes
CREATE INDEX IF NOT EXISTS idx_users_admin_archived ON users(role, archived_at);
CREATE INDEX IF NOT EXISTS idx_users_password_reset_pending ON users(password_reset_pending);
CREATE INDEX IF NOT EXISTS idx_users_account_version ON users(id, account_version);
```

### 3.2 Opaque Token Schema: `password_reset_tokens`
Completely abandon hybrid JWT approaches in favor of **100% opaque, high-entropy tokens**:
```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'admin_password_reset' CHECK(purpose IN ('admin_password_reset', 'user_recovery')),
  token_version INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  created_by_admin_id INTEGER REFERENCES users(id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, purpose)
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_lookup ON password_reset_tokens(user_id, token_hash, purpose);
```

---

## 4. Account Behaviour & Access Invalidation Matrix

### 4.1 State Definitions
1. **Active Admin:** `role = 'admin'`, `is_active = 1`, `archived_at IS NULL`, `password_reset_pending = 0`. Full administrative access.
2. **Inactive (Deactivated) Admin:** `role = 'admin'`, `is_active = 0`, `archived_at IS NULL`, `password_reset_pending = 0`. Temporarily blocked. Retains permissions and position in current administrator list.
3. **Archived Admin:** `role = 'admin'`, `archived_at IS NOT NULL`. Mark of former administrator. Excluded from current administrator lists, all credentials revoked, zero system access. Cannot be activated directly.
4. **Password Reset Pending:** `password_reset_pending = 1` (on Active or Inactive admin). All existing sessions and tokens revoked; cannot log in, refresh, or connect sockets until password replacement is completed.

### 4.2 Comprehensive Access Matrix

| Account State | Access Token API | Refresh Token | Password Login | MFA Verification | Socket Handshake | Can Be Activated? |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Active** | Allowed | Allowed | Allowed | Allowed | Allowed | N/A (Already 1) |
| **Inactive** | Denied (401) | Denied (401) | Denied (401) | Denied (401) | Denied (Error) | Yes (Super Admin) |
| **Archived** | Denied (401) | Denied (401) | Denied (401) | Denied (401) | Denied (Error) | **Blocked (400)** |
| **Reset Pending** | **Denied (403)** | **Denied (403)** | **Denied (403)** | **Denied (403)** | **Denied (Error)** | Preserved |

### 4.3 Enforcement Interceptors

1. **`authenticateToken` (`server/middleware/auth.js`):**
   ```javascript
   if (!user || user.deleted_at !== null || user.archived_at !== null) {
     return res.status(401).json({ error: 'Account inactive, archived, or not found' });
   }
   if (user.password_reset_pending === 1) {
     return res.status(403).json({ 
       error: 'Password reset pending for this account. You must set a new password before accessing the system.',
       code: 'PASSWORD_RESET_PENDING'
     });
   }
   if (user.is_active !== 1) {
     return res.status(401).json({ error: 'Account inactive or not found' });
   }
   ```

2. **`/api/auth/login` (`server/routes/auth.js`):**
   - Query filters `AND deleted_at IS NULL AND archived_at IS NULL`.
   - Explicit check: If account is archived, reject with HTTP 401.
   - If `user.password_reset_pending === 1`, reject with HTTP 403:
     `{ error: 'A password reset has been initiated for this account. You must set a new password using your reset link before logging in.', code: 'PASSWORD_RESET_PENDING' }`.

3. **`/api/auth/mfa-verify` (`server/routes/auth.js`):**
   - Check `user.archived_at === null` and `user.password_reset_pending === 0`.
   - If reset pending, reject with HTTP 403 (`PASSWORD_RESET_PENDING`).

4. **`/api/auth/refresh` (`server/routes/auth.js`):**
   - If `user.archived_at !== null` or `user.password_reset_pending === 1`, clear refresh cookie and reject with HTTP 403.

5. **Socket Handshake (`server/server.js`):**
   - Query checks `archived_at IS NULL` and `password_reset_pending = 0`.
   - Emits `session_revoked` and disconnects immediately if violated.

---

## 5. Mandatory Concurrency Protection & Account Lifecycle

### 5.1 Mandatory Account Versioning Pattern
Every mutation endpoint (`/archive`, `/restore`, `/status`, `/permissions`, `/reset-password`) **MANDATES** `expected_account_version` in the request body. If missing, null, or not an integer, the server immediately returns HTTP 400 Bad Request (`code: 'MISSING_ACCOUNT_VERSION'`).

Inside the database transaction:
```sql
UPDATE users 
SET ..., account_version = account_version + 1 
WHERE id = ? AND account_version = ? AND <state_prerequisite>
```
If `result.changes === 0`, the transaction throws a `CONCURRENCY_CONFLICT` error, rolling back all writes and returning HTTP 409 Conflict:
`{ error: 'Account state has changed or request is stale. Please reload the administrator details before retrying.', code: 'CONCURRENCY_CONFLICT' }`.

### 5.2 Archive Flow (`POST /api/admin/administrators/:id/archive`)
1. **Validation & State Check:**
   - Target cannot be Super Admin ID 1.
   - Requires mandatory `reason` (minimum 5 characters) and `expected_account_version`.
   - Requires recent password verification (`requireRecentAuth`).
2. **Atomic Execution (`db.transaction()`):**
   - Execute update with concurrency and state guard:
     ```sql
     UPDATE users 
     SET is_active = 0,
         archived_at = datetime('now'),
         archived_by_admin_id = ?,
         archive_reason = ?,
         token_version = token_version + 1,
         account_version = account_version + 1,
         password_reset_pending = 0
     WHERE id = ? AND account_version = ? AND archived_at IS NULL
     ```
     If `changes === 0`:
     - If `archived_at IS NOT NULL` -> Return HTTP 409 Conflict (`code: 'ALREADY_ARCHIVED'`).
     - Otherwise -> Return HTTP 409 Conflict (`code: 'CONCURRENCY_CONFLICT'`).
   - Invalidate all reset tokens: `DELETE FROM password_reset_tokens WHERE user_id = ?`. Outstanding links are permanently dead.
   - Invalidate sessions: `DELETE FROM sessions WHERE user_id = ?`.
   - Invalidate MFA challenges: `UPDATE mfa_login_challenges SET consumed = 1 WHERE user_id = ?`.
   - Record audit log: `module: 'admin_management'`, `action: 'archive_administrator'`, `throwOnError: true`.
3. **Real-time Disconnection:**
   - `securityEvents.emit('revoke_user', { userId: targetId })` immediately terminates all active WebSocket connections.

### 5.3 Restore Flow (`POST /api/admin/administrators/:id/restore`)
1. **Validation & State Check:**
   - Target cannot be Super Admin ID 1.
   - Requires mandatory `reason` and `expected_account_version`.
   - Requires recent password verification (`requireRecentAuth`).
2. **Atomic Execution (`db.transaction()`):**
   - Execute update with concurrency and state guard:
     ```sql
     UPDATE users 
     SET archived_at = NULL,
         restored_at = datetime('now'),
         restored_by_admin_id = ?,
         restore_reason = ?,
         is_active = 0, -- CRITICAL: RESTORED AS INACTIVE
         account_version = account_version + 1
     WHERE id = ? AND account_version = ? AND archived_at IS NOT NULL
     ```
     If `changes === 0`:
     - If `archived_at IS NULL` -> Return HTTP 409 Conflict (`code: 'NOT_ARCHIVED'`).
     - Otherwise -> Return HTTP 409 Conflict (`code: 'CONCURRENCY_CONFLICT'`).
   - Old sessions and reset tokens remain dead.
   - Record audit log: `module: 'admin_management'`, `action: 'restore_administrator'`, `details: { restored_status: 'inactive' }`, `throwOnError: true`.
3. **Explicit Activation Requirement:**
   - Restored account is inactive. Super Admin must separately review permissions and activate via `PATCH /api/admin/administrators/:id/status`.

### 5.4 Guarding Status Activation Against Archived Accounts
In `PATCH /api/admin/administrators/:id/status`:
```sql
UPDATE users 
SET is_active = ?,
    token_version = token_version + 1,
    account_version = account_version + 1,
    updated_at = datetime('now')
WHERE id = ? AND account_version = ? AND archived_at IS NULL
```
If `changes === 0`: Check if user is archived. If `archived_at IS NOT NULL`, return HTTP 400 Bad Request (`code: 'ACCOUNT_ARCHIVED'`, error: `'Cannot activate an archived administrator. The account must be restored by Super Admin first.'`).

---

## 6. Super Admin-Initiated Password Reset Subsystem

### 6.1 Token Generation & Verification Protocol
- **Cryptographic Randomness:** `const rawToken = crypto.randomBytes(32).toString('hex')` (64 hex characters, 256 bits of entropy).
- **Storage:** Hash with SHA-256 before database insertion (`const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')`).
- **Expiry:** Strict **30 minutes** (`expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString()`).
- **Purpose Binding:** `purpose = 'admin_password_reset'`.
- **Credential Version Pinning:** The record in `password_reset_tokens` stores the target's current `token_version`.
- **Global Reset Invalidation:** Every password-modifying route in the system (admin reset, self-service change password, profile update) **MUST** execute:
  ```sql
  DELETE FROM password_reset_tokens WHERE user_id = ?;
  UPDATE users SET password_reset_pending = 0, token_version = token_version + 1 WHERE id = ?;
  ```
  This guarantees that changing a password through any path immediately kills any outstanding reset link.

### 6.2 Initiation Endpoints & Delivery Modes

Super Admin can choose between two explicit endpoints based on ownership status:

#### Option A: Verified Email Dispatch (`POST /api/admin/administrators/:id/reset-password/email`)
- **Preconditions:**
  - Target `email_verified_at IS NOT NULL`. If unverified, returns HTTP 400 (`code: 'EMAIL_NOT_VERIFIED'`).
  - Target cannot be Super Admin ID 1.
  - Requires `reason`, `expected_account_version`, and password re-verification (`requireRecentAuth`).
- **Atomic Setup:**
  - In `db.transaction()`:
    - Atomically overwrite `password_reset_tokens` (deletes prior token for this user and purpose).
    - Insert new token record with hash, 30m expiry, and target's `token_version`.
    - Update user: `password_reset_pending = 1, password_reset_requested_at = datetime('now'), password_reset_requested_by = req.user.id, token_version = token_version + 1, account_version = account_version + 1`.
    - Delete target's sessions and revoke MFA challenges.
    - Record audit log: `action: 'admin.reset_password_initiated'`, `outcome: 'success'`, `throwOnError: true`.
  - Disconnect sockets via `securityEvents.emit('revoke_user')`.
- **SMTP Gateway Submission:**
  - Constructs URL: `${process.env.APP_BASE_URL}/admin/reset-password/${target.id}/${rawToken}`.
  - Attempts transmission via nodemailer.
  - **SMTP Success:**
    - Records audit log: `action: 'admin.mail_submitted'`, `outcome: 'success'`, `details: { recipient: target.email, note: 'Submitted to SMTP gateway; does not confirm mailbox receipt' }`.
    - Returns HTTP 200: `{ success: true, message: 'Password reset link has been submitted to the administrator\'s verified email address.' }`.
  - **SMTP Failure:**
    - Records audit log: `action: 'admin.mail_submission_failed'`, `outcome: 'failed'`, `details: { recipient: target.email, error: redact(err.message) }`.
    - **Crucial Rule:** Does NOT generate a fallback link or report success!
    - Returns HTTP 502 Bad Gateway: `{ error: 'Failed to submit email to mail gateway. Reset was initiated but email was not sent. You may retry or use manual direct link generation.', code: 'SMTP_SUBMISSION_FAILED' }`.

#### Option B: Out-of-Band Direct Link Generation (`POST /api/admin/administrators/:id/reset-password/direct-link`)
- **Preconditions:**
  - Explicitly selected by Super Admin (e.g. for unverified emails or air-gapped handoff).
  - Target cannot be Super Admin ID 1.
  - Requires `reason`, `expected_account_version`, and password re-verification (`requireRecentAuth`).
- **Atomic Setup:**
  - Same atomic token generation, session revocation, and `password_reset_pending = 1` as Option A.
  - Records audit log: `action: 'admin.direct_reset_link_generated'`, `outcome: 'success'`, `details: { reason, delivery_channel: 'out_of_band' }`. (Raw token is **NEVER** stored in audit logs or console).
- **Response:**
  - Returns HTTP 200: `{ success: true, resetLink: `${process.env.APP_BASE_URL}/admin/reset-password/${target.id}/${rawToken}`, expires_in_minutes: 30 }`.
  - Frontend presents a secure, single-view modal with a copy button and a warning that the link will not be displayed again.

### 6.3 Password Replacement Flow (`POST /api/admin/reset-password/:id/:token`)
1. **Validation & Rate Limiting:**
   - Dedicated IP rate limit: 5 requests per 15 minutes.
   - Password validated against [`validatePassword`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/.worktrees/super-admin-integration/server/middleware/auth.js#L382).
   - Computes SHA-256 of incoming raw token.
2. **Atomic Consumption & Replacement (`db.transaction()`):**
   - Query user: Must have `deleted_at IS NULL` and `archived_at IS NULL`. (Archived users receive HTTP 400 `ACCOUNT_ARCHIVED`).
   - Query token:
     ```sql
     SELECT id, token_version FROM password_reset_tokens 
     WHERE user_id = ? AND token_hash = ? AND purpose = 'admin_password_reset' AND datetime(expires_at) > datetime('now')
     ```
     If not found: Return HTTP 400 (`code: 'INVALID_OR_EXPIRED_RESET_LINK'`).
   - **Credential Version Check:** If `token.token_version !== user.token_version`, reject with HTTP 400 (`code: 'CREDENTIAL_VERSION_MISMATCH'`).
   - **Atomic Consumption Guard:**
     ```sql
     DELETE FROM password_reset_tokens WHERE id = ?
     ```
     If `changes === 0`: Race condition lost -> return HTTP 400 `TOKEN_ALREADY_USED`.
   - Update password hash, increment `account_version` and `token_version`, clear reset pending:
     ```sql
     UPDATE users 
     SET password_hash = ?,
         password_reset_pending = 0,
         password_reset_requested_at = NULL,
         password_reset_requested_by = NULL,
         token_version = token_version + 1,
         account_version = account_version + 1,
         updated_at = datetime('now')
     WHERE id = ?
     ```
     *(Notice: `is_active` is NOT touched. Inactive admins remain inactive).*
   - Invalidate all sessions: `DELETE FROM sessions WHERE user_id = ?`.
   - Record audit log: `module: 'security'`, `action: 'admin.reset_password_completed'`, `target_user_id: user.id`, `throwOnError: true`.
3. **Completion Notification (Without Secrets):**
   - If the administrator's email is verified (`email_verified_at IS NOT NULL`), dispatch an asynchronous security notice:
     - Subject: `Security Alert: Your BFI Classroom Administrative Password Has Been Changed`
     - Body: Informs the administrator that their password was successfully reset on `<date/time>` from IP `<ip>`. Contains **NO secrets, tokens, or credentials**. Advises contacting Super Admin immediately if unrecognized.

### 6.4 Recovery Page Security Hardening
- **Trusted Base URL:** Reset links strictly use `process.env.APP_BASE_URL` (or verified `process.env.CLIENT_URL`). Never trust unvalidated `req.headers.origin` or `req.headers.host`.
- **Zero Log Leakage:** Reset tokens must never be written to access logs, application console, or analytics.
- **Zero Third-Party Assets:** The reset page is completely self-contained. No external CDN scripts, third-party fonts, or tracking scripts that could receive the URL in a `Referer` header.
- **HTTP Response Headers:**
  - `Referrer-Policy: no-referrer`
  - `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
  - `Pragma: no-cache`
  - `X-Content-Type-Options: nosniff`

---

## 7. History Retention & Export Subsystem

### 7.1 Retention Policy Specification
1. **Preservation of History:** Archiving an administrator does not delete or alter any audit logs, permission changes, batch assignments, created courses, graded student assignments, or fee transactions.
2. **Honest Historical Boundaries:** The application records historical events starting from the implementation date of respective logging subsystems. Prior events are not fabricated. Creator attribution displays `"Unknown/Legacy"` when `created_by_admin_id IS NULL`.
3. **No Automatic Purges:** There is no automatic time-to-live expiration or disposal of administrative audit records in this release.

### 7.2 Multi-Cycle Archive/Restore Accountability Timeline
In `GET /api/admin/administrators/:id/accountability-profile`:
- Queries all audit records where `target_user_id = ?` and `action IN ('archive_administrator', 'restore_administrator')` ordered by `id ASC`.
- Builds a dedicated **Archive & Restoration Lifecycle Timeline** displaying every past archive/restore cycle with cycle count, action, Dhaka timestamp, operator identity, and reason.

### 7.3 Audited Export Subsystem (`GET /api/admin/administrators/:id/export-history`)
- **Server Authorization:** `authenticateToken`, `requireSuperAdmin`, `requireRecentAuth`.
- **Filters:** `module`, `outcome`, `startDate`, `endDate`, `direction` ('performed', 'received', 'all'), `format` ('csv', 'json').
- **Hard Limit:** Maximum **5,000 records** per export. Truncation signaled via header `X-Export-Truncated: true`.
- **Sensitive Data Exclusion:** Scrubbed via `redactSensitiveData()` to remove passwords, tokens, MFA secrets, and recovery codes.
- **CSV Formula Injection (CSV Injection / DDE) Defense Algorithm:**
  Spreadsheet applications execute formulas starting with `=`, `+`, `-`, `@`, `\t`, or `\r`.
  *Sanitization Implementation:*
  ```javascript
  export function sanitizeCsvField(val) {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    
    // Detect formula injection even with leading whitespace or control characters
    const trimmed = str.replace(/^[\s\u0000-\u001f]+/, '');
    if (/^[=+@\-\t\r]/.test(trimmed)) {
      // Neutralize executable formula by prefixing with a single quote
      str = "'" + str;
    }
    
    // Standard RFC 4180 CSV escaping: wrap in quotes, escape internal quotes
    return `"${str.replace(/"/g, '""')}"`;
  }
  ```
- **Audit Logging:** Every export request logs an entry in `admin_audit_logs`.

---

## 8. User Interface Architecture (Admin Management)

### 8.1 Dual Tab Layout & Accurately Labeled Counts
In `src/pages/admin/AdminManagement.jsx`:
- **Tabs:** "Current Administrators" and "Archived Administrators".
- **KPI Summary Cards (Mutually Exclusive, Explicitly Labeled):**
  - **Total Current Admins:** Counts all admins where `deleted_at IS NULL AND archived_at IS NULL` (includes Super Admin).
  - **Active Admins:** Current admins with `is_active = 1`.
  - **Inactive Admins:** Current admins with `is_active = 0`.
  - **Archived Admins:** Former admins where `deleted_at IS NULL AND archived_at IS NOT NULL`. Labeled: *"Former administrators preserved for accountability; not included in current totals."*

### 8.2 Modals & Flows
1. **Archive Admin Modal:**
   - Displays clear warning on access removal and history preservation.
   - Shows current `account_version` (sent in payload as `expected_account_version`).
   - Requires mandatory Reason and Sudo Password.
2. **Restore Admin Modal:**
   - Displays notice that the account will be restored as **INACTIVE**.
   - Requires mandatory Reason, `expected_account_version`, and Sudo Password.
3. **Reset Password Modal:**
   - Displays target administrator details and verified email status.
   - If verified: Offers "Send to Verified Email" or "Generate Out-of-Band Link".
   - If unverified: Displays notice that email is unverified; only "Generate Out-of-Band Link" is available.
   - Requires Reason, `expected_account_version`, and Sudo Password.
   - Secure Link Display Modal allows one-time copying with an expiry timer.

---

## 9. Comprehensive Testing & Verification Plan

### 9.1 Test Isolation & Safety
- **Strict Guard:** All tests run exclusively against disposable, isolated SQLite databases (`tests/test-db-isolation.js`).
- **Zero Production Modification:** `server/bfi_classroom.db` is never touched by tests.

### 9.2 Automated Test Scenarios (`tests/admin-archiving-and-reset.spec.js`)

1. **Role & Privilege Enforcement:**
   - Ordinary admins or instructors attempting archive, restore, or reset receive HTTP 403.
   - Attempting to archive, deactivate, or peer-reset Super Admin ID 1 receives HTTP 403.

2. **Access Blocking During Password Reset:**
   - Reset initiated -> `password_reset_pending = 1`.
   - Verify `authenticateToken`, `/api/auth/login`, `/api/auth/mfa-verify`, `/api/auth/refresh`, and socket connection all reject with HTTP 403.
   - Successful password replacement clears `password_reset_pending = 0`.
   - Inactive account remains inactive after password reset.

3. **Mandatory Concurrency Protection (`account_version`):**
   - Mutation requests missing `expected_account_version` receive HTTP 400.
   - Stale version submissions receive HTTP 409 `CONCURRENCY_CONFLICT`.
   - Cycle test: Admin archived -> restored -> stale archive request with old version is rejected.

4. **Token Lifecycle & Expiry:**
   - Verify token expires after 30 minutes; expired token returns HTTP 400.
   - Initiate reset twice -> verify older token is destroyed and cannot be used.
   - Global invalidation: User changes password via profile -> outstanding reset token is deleted.
   - Race condition test: Concurrent token submissions result in exactly 1 success and 1 HTTP 400 `TOKEN_ALREADY_USED`.

5. **Email Ownership & Failure Handling:**
   - Attempting email reset on unverified address receives HTTP 400 `EMAIL_NOT_VERIFIED`.
   - Mock SMTP failure -> recorded as `admin.mail_submission_failed` and returns HTTP 502 (never recorded as success).
   - Direct link generation requires explicit authorization and logs `admin.direct_reset_link_generated`.

6. **Audit-Write Rollback Across All Operations:**
   - Mock audit failure during `/archive` -> transaction rolls back; admin remains unarchived.
   - Mock audit failure during `/restore` -> transaction rolls back; admin remains archived.
   - Mock audit failure during `/reset-password` -> transaction rolls back; reset pending not set.
   - Mock audit failure during password replacement -> transaction rolls back; old password remains.

7. **CSV Formula Injection:**
   - Export with values `=cmd|' /C calc'!A0`, `   +SUM(1+1)`, `\t@danger`, `"  -2+3"`.
   - Verify all formula indicators are neutralized with `'` prefix and RFC 4180 quotes.
