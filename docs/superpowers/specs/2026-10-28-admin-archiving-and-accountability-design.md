# Architectural Design Specification: Admin Archiving, Accountability Ledger & Super Admin-Initiated Password Reset

**Document Status:** Revised for User Approval (v4)  
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

### 2.3 Recovery Email Mechanism Reality & Explicit Address Binding
*Source:* `server/db/database.js:38-56` (`users` schema) & `server/routes/admin-management.js:1099-1145`
- The `users` table contains `email TEXT UNIQUE NOT NULL`, but **has no verification columns**.
- Admin emails are assigned directly by Super Admin upon creation and validated only via regex `validateEmail(email)`. No verification email handshake exists in BFI Classroom.
- **Zero-Assumption Rule:** Super Admin clicking "confirm" does **not** verify mailbox ownership. Sending credentials or reset tokens to an unproven address risks account takeover or credential leakage if a typo was made.
- **Explicit Email Ownership Verification Architecture:**
  - Introduce `users.email_verified_at TEXT DEFAULT NULL` and `users.verified_email TEXT DEFAULT NULL`.
  - Introduce `email_verification_challenges` table binding `user_id`, `email`, `token_hash`, `purpose = 'email_verification'`, `expires_at`, and `consumed`.
  - **Normal Flow:** An authenticated administrator must initiate verification (`POST /api/auth/verify-email/request`). A challenge token is sent to that specific mailbox. The administrator completes verification (`POST /api/auth/verify-email/confirm`), updating `email_verified_at = datetime('now')` and `verified_email = challenge.email`.
  - **Email Mutation Rule:** Any update to `users.email` (via profile or admin management) **must immediately clear verification**:
    ```sql
    UPDATE users SET email_verified_at = NULL, verified_email = NULL WHERE id = ?;
    UPDATE email_verification_challenges SET consumed = 1 WHERE user_id = ?;
    DELETE FROM password_reset_tokens WHERE user_id = ?;
    ```
  - **Existing Accounts Start Unverified:** All existing accounts remain unverified (`email_verified_at IS NULL`); they are never automatically assumed verified.
  - **No Automatic Reset Dispatch to Unverified Addresses:** If `targetUser.email_verified_at IS NULL` or `targetUser.email !== targetUser.verified_email`, the server rejects email reset dispatch with HTTP 400 `EMAIL_NOT_VERIFIED`.
- **Manual Delivery as a Separate, Explicit Recovery Option:**
  - Manual out-of-band delivery is **NOT** an automatic fallback after SMTP failure.
  - It is an explicit, separately chosen recovery option ("Generate Out-of-Band Single-Use Link") that Super Admin must intentionally select when:
    a) The administrator's email is unverified, OR
    b) Super Admin explicitly opts for physical/in-person or secure out-of-band delivery after independently confirming the recipient's identity.
  - Requires explicit Super Admin justification, password re-verification (`requireRecentAuth`), and is logged in the audit ledger under `admin.direct_reset_link_generated`.

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

---

## 3. Database Schema Extensions & Migration Specification

A new migration `server/db/migrations/20261028_admin_archiving_and_reset.cjs` will be executed within an atomic SQLite transaction and registered in the canonical runner `scripts/run_migrations.cjs`.

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
ALTER TABLE users ADD COLUMN verified_email TEXT DEFAULT NULL;

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

### 3.2 Email Verification Challenges Table
```sql
CREATE TABLE IF NOT EXISTS email_verification_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'email_verification',
  expires_at TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_email_verification_lookup ON email_verification_challenges(user_id, token_hash, consumed);
```

### 3.3 Transactional Migration of `password_reset_tokens`
*Source-Code Inspection Note:* The existing table `password_reset_tokens` was inspected from source code definitions in `server/db/database.js:452-459` and `server/routes/auth.js:1175,1288`:
`CREATE TABLE IF NOT EXISTS password_reset_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));`.
It lacks `purpose`, `token_version`, and `created_by_admin_id`. Its unique constraint is `UNIQUE(user_id)`. The live schema will be directly verified on an isolated database during migration testing.

*Transactional Migration Pattern:*
```javascript
const fkStatus = db.prepare('PRAGMA foreign_keys').get();
const wasFkOn = Object.values(fkStatus)[0] === 1;

try {
  db.pragma('foreign_keys = OFF');
  const tx = db.transaction(() => {
    // 1. Rename existing table
    db.prepare(`ALTER TABLE password_reset_tokens RENAME TO _password_reset_tokens_old`).run();

    // 2. Create updated table supporting purpose separation and version binding
    db.prepare(`
      CREATE TABLE password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'user_recovery' CHECK(purpose IN ('user_recovery', 'admin_self_recovery', 'admin_password_reset')),
        token_version INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        created_by_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, purpose)
      )
    `).run();

    // 3. Drop old table, safely invalidating legacy reset links
    db.prepare(`DROP TABLE _password_reset_tokens_old`).run();

    // 4. Create indexes
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_lookup ON password_reset_tokens(user_id, token_hash, purpose)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at)`).run();

    // 5. Record migration in app_migrations
    db.prepare(`INSERT INTO app_migrations (name) VALUES ('20261028_admin_archiving_and_reset')`).run();
  });
  tx();
} finally {
  if (wasFkOn) {
    db.pragma('foreign_keys = ON');
  }
}
```
*Documented Consequence:* Any unconsumed reset links generated prior to migration are safely invalidated.
*Preservation of All Three Recovery Flows:*
1. **Flow 1: Student / Ordinary User Recovery** (`/forgot-password` & `/reset-password/:id/:token`):
   - Inserts with `purpose = 'user_recovery'`, `token_version = user.token_version || 1`, 15-minute expiry.
   - Consumes with `purpose = 'user_recovery'`.
2. **Flow 2: Admin Self-Service Recovery** (`/admin-forgot-password` & `/admin-reset-password/:id/:token`):
   - Inserts with `purpose = 'admin_self_recovery'`, `token_version = user.token_version || 1`, 15-minute expiry.
   - Consumes with `purpose = 'admin_self_recovery'`.
3. **Flow 3: Super Admin-Initiated Reset** (`/reset-password/email` & `/reset-password/direct-link`):
   - Inserts with `purpose = 'admin_password_reset'`, `token_version = new_token_version`, 30-minute expiry, `created_by_admin_id = superAdmin.id`.
   - Consumes via `/api/admin/reset-password/complete`.

---

## 4. Account Behaviour & Access Invalidation Matrix

### 4.1 State Definitions
1. **Active Admin:** `role = 'admin'`, `is_active = 1`, `archived_at IS NULL`, `password_reset_pending = 0`. Full administrative access.
2. **Inactive (Deactivated) Admin:** `role = 'admin'`, `is_active = 0`, `archived_at IS NULL`, `password_reset_pending = 0`. Temporarily blocked. Retains permissions and position in current administrator list.
3. **Archived Admin:** `role = 'admin'`, `archived_at IS NOT NULL`. Mark of former administrator. Excluded from current administrator lists, all credentials revoked, zero system access. Cannot be activated directly. `password_reset_pending` is 0.
4. **Password Reset Pending:** `password_reset_pending = 1` (on Active or Inactive admin, `archived_at IS NULL`). All existing sessions and tokens revoked; cannot log in, refresh, or connect sockets until password replacement is completed.

### 4.2 Comprehensive Access & Error Matrix

| Account State | Access Token API | Refresh Token | Password Login | MFA Verification | Socket Handshake | Status Activation (`/status`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Active** | 200 OK | 200 OK | 200 OK | 200 OK | Connected | N/A |
| **Inactive** | **401** `Account inactive` | **401** `User not found` | **401** `Invalid credentials` | **401** `Account inactive` | **Error** `inactive` | **Allowed** |
| **Archived** | **401** `Account inactive, archived, or not found` | **401** `User not found` | **401** `Invalid credentials` | **401** `Account inactive or revoked` | **Error** `inactive or revoked` | **400** `ACCOUNT_ARCHIVED` |
| **Reset Pending** | **403** `PASSWORD_RESET_PENDING` | **403** `PASSWORD_RESET_PENDING` | **403** `PASSWORD_RESET_PENDING` | **403** `PASSWORD_RESET_PENDING` | **Error** `reset pending` | Preserved |

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
   - If `user.password_reset_pending === 1`, reject with HTTP 403 `PASSWORD_RESET_PENDING`.

3. **`/api/auth/mfa-verify` (`server/routes/auth.js`):**
   - Check `user.archived_at === null`. If archived or inactive, reject with HTTP 401.
   - If `user.password_reset_pending === 1`, reject with HTTP 403 `PASSWORD_RESET_PENDING`.

4. **`/api/auth/refresh` (`server/routes/auth.js`):**
   - If `user.archived_at !== null` or inactive, clear cookie and reject with HTTP 401.
   - If `user.password_reset_pending === 1`, clear refresh cookie and reject with HTTP 403.

5. **Socket Handshake (`server/server.js`):**
   - Query checks `archived_at IS NULL` and `password_reset_pending = 0`.
   - Disconnects immediately with `session_revoked`.

---

## 5. Mandatory Concurrency Protection & Account Lifecycle

### 5.1 Internal Account Versioning Pattern
Every mutation endpoint (`/archive`, `/restore`, `/status`, `/permissions`, `/reset-password`) **MANDATES** `expected_account_version` in the request body. If missing, null, or not an integer, the server immediately returns HTTP 400 Bad Request (`code: 'MISSING_ACCOUNT_VERSION'`).
*UI Constraint:* The frontend sends `expected_account_version` internally via state/API client; it is **never** shown in user-facing confirmation modals.

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

### 6.1 Token Generation, Storage & Version Pinning
- **Cryptographic Randomness:** `const rawToken = crypto.randomBytes(32).toString('hex')` (64 hex characters, 256 bits of entropy).
- **Storage:** Hash with SHA-256 before database insertion (`const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')`).
- **Expiry:** Strict **30 minutes** (`expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString()`).
- **Purpose Binding:** `purpose = 'admin_password_reset'`.
- **Order of Execution in Transaction (Preventing Token Version Mismatch):**
  1. Update user account first:
     ```sql
     UPDATE users 
     SET password_reset_pending = 1,
         password_reset_requested_at = datetime('now'),
         password_reset_requested_by = ?,
         token_version = token_version + 1,
         account_version = account_version + 1
     WHERE id = ? AND account_version = ?
     RETURNING token_version;
     ```
  2. Bind the new reset token directly to the **resulting** `token_version` (V+1):
     ```sql
     INSERT INTO password_reset_tokens (user_id, token_hash, purpose, token_version, expires_at, created_by_admin_id)
     VALUES (?, ?, 'admin_password_reset', ?, ?, ?)
     ON CONFLICT(user_id, purpose) DO UPDATE SET
       token_hash = excluded.token_hash,
       token_version = excluded.token_version,
       expires_at = excluded.expires_at,
       created_at = datetime('now'),
       created_by_admin_id = excluded.created_by_admin_id;
     ```
  3. Delete target's active sessions and MFA challenges.
  4. Disconnect target's active sockets.
- **Global Reset Invalidation:** Every password-modifying route in the system (admin reset, self-service change password, profile update) **MUST** execute:
  ```sql
  DELETE FROM password_reset_tokens WHERE user_id = ?;
  UPDATE users SET password_reset_pending = 0, token_version = token_version + 1 WHERE id = ?;
  ```

### 6.2 Token-Leak Prevention & Fragment-Based URL Architecture
- **Vulnerability in URL Paths:** Passing tokens in URL paths exposes them to reverse proxy, Cloudflare, and Nginx access logs.
- **Concrete Fix: URL Fragment (Hash) Transport:**
  Reset URLs are generated as:
  ```
  ${process.env.APP_BASE_URL}/admin/reset-password#userId=${target.id}&token=${rawToken}
  ```
- **Router Mounting in `src/App.jsx`:**
  Mount `/admin/reset-password` without session-locking wrappers:
  ```jsx
  <Route path="/admin/reset-password" element={<AdminResetPassword />} />
  ```
  Respects application `basename={routerBase}` and works directly while logged out.
- **Browser Client Behavior (`src/pages/AdminResetPassword.jsx`):**
  1. The browser navigates to `/admin/reset-password`. Because fragments (`#...`) are never transmitted in HTTP requests, the raw token is **never** sent to the web server or reverse proxy.
  2. The client component reads fragment parameters:
     ```javascript
     const hashParams = new URLSearchParams(window.location.hash.slice(1));
     const userId = hashParams.get('userId');
     const token = hashParams.get('token');
     ```
  3. The component **immediately** purges the fragment from browser history:
     ```javascript
     window.history.replaceState(null, '', window.location.pathname);
     ```
  4. When the user sets their password, the token is sent in the **POST body**:
     `POST /api/admin/reset-password/complete` with `{ userId, token, password }`.
- **Server-Side Exclusion:**
  - Request bodies of `/reset-password` endpoints and direct-link responses are excluded from Winston/Morgan logging, console logs, analytics, and error tracking.
  - Direct-link generation responses include headers:
    `Cache-Control: no-store, no-cache, must-revalidate`, `Pragma: no-cache`.

### 6.3 Delivery Endpoints & Auditing

Super Admin chooses between two explicit endpoints based on verified status:

#### Option A: Verified Email Dispatch (`POST /api/admin/administrators/:id/reset-password/email`)
- **Preconditions:**
  - Target `email_verified_at IS NOT NULL` AND `email === verified_email`. If unverified, returns HTTP 400 `EMAIL_NOT_VERIFIED`.
  - Target cannot be Super Admin ID 1.
  - Requires `reason`, `expected_account_version`, and password re-verification (`requireRecentAuth`).
- **Atomic Setup:** Runs order of execution specified in Section 6.1.
- **SMTP Gateway Submission:**
  - Dispatches email with URL fragment link.
  - **SMTP Success:** Audit log `action: 'admin.mail_submitted'`, `details: { recipient: target.email, note: 'Submitted to SMTP gateway; does not confirm mailbox receipt' }`. Returns HTTP 200.
  - **SMTP Failure:** Audit log `action: 'admin.mail_submission_failed'`, `outcome: 'failed'`, `details: { recipient: target.email, error: redact(err.message) }`. Returns HTTP 502 `SMTP_SUBMISSION_FAILED`. **Does NOT generate a fallback link or record success.**

#### Option B: Out-of-Band Direct Link Generation (`POST /api/admin/administrators/:id/reset-password/direct-link`)
- **Preconditions:**
  - Explicitly selected by Super Admin (for unverified emails or air-gapped handoff).
  - Target cannot be Super Admin ID 1.
  - Requires `reason`, `expected_account_version`, and password re-verification (`requireRecentAuth`).
- **Atomic Setup:** Runs order of execution specified in Section 6.1.
- **Audit:** Logs `action: 'admin.direct_reset_link_generated'`, `details: { reason, delivery_channel: 'out_of_band' }`. Raw token is **never** written to audit logs or logs.
- **Response:** Returns HTTP 200 with `Cache-Control: no-store`:
  `{ success: true, resetLink: "${process.env.APP_BASE_URL}/admin/reset-password#userId=${target.id}&token=${rawToken}", expires_in_minutes: 30 }`.
  Frontend presents a secure modal with one-time copy button and countdown timer.

### 6.4 Password Replacement Flow (`POST /api/admin/reset-password/complete`)
1. **Validation:**
   - Rate limited to 5 attempts per 15 minutes per IP.
   - Requires `userId`, `token`, and `password` in request body.
   - Validates `password` against [`validatePassword`](file:///E:/Antigravity/Project%202%20-%20BFI%20Classroom/.worktrees/super-admin-integration/server/middleware/auth.js#L382).
   - Computes SHA-256 of incoming raw token.
2. **Atomic Consumption (`db.transaction()`):**
   - Query user: Must have `deleted_at IS NULL` and `archived_at IS NULL`.
   - Query token:
     ```sql
     SELECT id, token_version FROM password_reset_tokens 
     WHERE user_id = ? AND token_hash = ? AND purpose = 'admin_password_reset' AND datetime(expires_at) > datetime('now')
     ```
     If not found: Return HTTP 400 `INVALID_OR_EXPIRED_RESET_LINK`.
   - **Credential Version Check:** Check `token.token_version === user.token_version`. If mismatch, return HTTP 400 `CREDENTIAL_VERSION_MISMATCH`.
   - **Atomic Consumption Guard:** `DELETE FROM password_reset_tokens WHERE id = ?`. If `changes === 0`, return HTTP 400 `TOKEN_ALREADY_USED`.
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
   - Delete all sessions: `DELETE FROM sessions WHERE user_id = ?`.
   - Record audit log: `module: 'security'`, `action: 'admin.reset_password_completed'`, `target_user_id: user.id`.
3. **Completion Notification (Without Secrets):**
   - If email is verified, send async security notification alerting the administrator that their password was changed on `<date/time>` from IP `<ip>`, containing **no secrets or credentials**.

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

### 8.1 Tab Structure & Feature Preservation
In `src/pages/admin/AdminManagement.jsx`:
- **Preserved Existing Tabs:**
  1. `administrators`: Manage Administrator Accounts
  2. `defaults`: Default Permissions
  3. `audit`: Operational Audit Ledger
  4. `security`: Super Admin MFA & Sessions
- **Within the `administrators` Tab:**
  - Sub-view navigation toggles between:
    - **Current Administrators** (Active and Inactive admins; excludes archived admins)
    - **Archived Administrators** (Former admins preserved for accountability)
- **KPI Summary Cards (Mutually Exclusive, Explicitly Labeled):**
  - **Total Current Admins:** Counts all admins where `deleted_at IS NULL AND archived_at IS NULL` (includes Super Admin).
  - **Active Admins:** Current admins with `is_active = 1`.
  - **Inactive Admins:** Current admins with `is_active = 0`.
  - **Archived Admins:** Former admins where `deleted_at IS NULL AND archived_at IS NOT NULL`. Labeled: *"Former administrators preserved for accountability; not included in current totals."*

### 8.2 Modals & Flows
1. **Archive Admin Modal:**
   - Displays clear warning on access removal and history preservation.
   - Requires mandatory Reason and Sudo Password.
   - Passes `expected_account_version` internally.
2. **Restore Admin Modal:**
   - Displays notice that the account will be restored as **INACTIVE**.
   - Requires mandatory Reason and Sudo Password.
   - Passes `expected_account_version` internally.
3. **Reset Password Modal:**
   - Displays target administrator details and verified email status.
   - If verified: Offers "Send to Verified Email" or "Generate Out-of-Band Link".
   - If unverified: Displays notice that email is unverified; only "Generate Out-of-Band Link" is available.
   - Requires Reason and Sudo Password.
   - Passes `expected_account_version` internally.
   - Out-of-Band Link modal provides single-view copy button with clear warning and timer.
