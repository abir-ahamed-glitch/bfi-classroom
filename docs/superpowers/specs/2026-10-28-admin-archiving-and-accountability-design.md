# Architectural Design Specification: Admin Archiving, Accountability Ledger & Super Admin-Initiated Password Reset

**Document Status:** Pending User Review & Approval  
**Date:** 2026-10-28  
**Workspace:** `E:\Antigravity\Project 2 - BFI Classroom\.worktrees\super-admin-integration`  
**Target Branch:** `integration/super-admin-candidate`  
**Author:** Antigravity Engineering (Superpowers Architectural Workflow)

---

## 1. Executive Summary & Purpose

This specification defines the architectural design, security controls, database schema extensions, and interface contracts for two interrelated subsystems in **BFI Classroom**:
1. **Admin Archiving & Preserved Accountability History**: Moving former administrators out of active administration without deleting account identities, audit history, creator attribution, or dependent business records (students, batches, courses, payments).
2. **Super Admin-Initiated Administrator Password Reset**: Enabling the Super Admin to initiate a controlled, single-use, expiring password reset for an administrator, with a persistent reset-pending state that blocks all system access until password replacement is completed.

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
- `requireRecentAuth` validates that the administrator has verified their password within the preceding **15 minutes** bound strictly to the active session (`sessions.sudo_verified_at`), or provided an inline `x-sudo-password`/`req.body.sudo_password`, or an `x-sudo-token` JWT.
- If unverified, returns HTTP 428 Precondition Required (`code: 'SUDO_REQUIRED'`, `requireSudo: true`).
*Design Constraint:* Archiving, Restoring, Password Reset Initiation, and History Export strictly require `requireRecentAuth`.

### 2.3 Recovery Email Mechanism Reality
*Source:* `server/db/database.js:38-56` (`users` schema) & `server/routes/admin-management.js:1099-1145`
- The `users` table contains `email TEXT UNIQUE NOT NULL`, but **has no `email_verified`, `is_verified`, or `email_verified_at` column**.
- Admin emails are assigned directly by Super Admin upon creation and validated only via regex `validateEmail(email)`. No verification email handshake exists in BFI Classroom.
- Email dispatch in `server/utils/email.js` uses Gmail SMTP (`EMAIL_USER`, `EMAIL_PASS`). SMTP may fail, be rate-limited, or be unconfigured in certain deployment environments.
*Design Resolution:*
1. The UI confirmation dialog explicitly presents the target administrator's username, full name, and stored email address, stating that the email was entered at creation and prompting Super Admin to confirm ownership.
2. The server attempts delivery via `sendPasswordResetEmail`.
3. If email delivery succeeds: Returns `{ success: true, delivery: 'email' }`.
4. If email delivery fails: The failure is recorded in the audit ledger, but a single-use expiring reset link is generated and returned in a secure one-time modal for Super Admin to manually copy and deliver out-of-band.

### 2.4 Token Version, Session Invalidation & Sockets
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

-- Persistent password reset pending state
ALTER TABLE users ADD COLUMN password_reset_pending INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN password_reset_requested_at TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN password_reset_requested_by INTEGER REFERENCES users(id) DEFAULT NULL;

-- Performant index for listing current vs archived admins and checking reset status
CREATE INDEX IF NOT EXISTS idx_users_admin_archived ON users(role, archived_at);
CREATE INDEX IF NOT EXISTS idx_users_password_reset_pending ON users(password_reset_pending);
```

### 3.2 Additions to `password_reset_tokens` Table
*Existing Schema:* `user_id INTEGER UNIQUE`, `token_hash TEXT`, `expires_at TEXT`.  
Ensure `password_reset_tokens` supports the 30-minute expiry and single-use consumption.
```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_lookup ON password_reset_tokens(user_id, token_hash);
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
   - Explicit check: If account is archived, reject.
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

## 5. Admin Archiving & Restoration Lifecycle

### 5.1 Safeguards & Invariants
- **Protected Accounts:** Super Admin (ID 1) cannot be archived, deactivated, or peer-reset. Attempt returns HTTP 403.
- **Server-Side Authorization:** Strictly `requireSuperAdmin` and `requireRecentAuth`.
- **Reason & Confirmation:** Mandatory non-empty `reason` (minimum 5 characters, sanitized) on archive and restore.
- **Atomic Operations:** Account changes and audit ledger writes execute within `db.transaction()`. If the audit write fails, all database modifications rollback.

### 5.2 Archive Flow (`POST /api/admin/administrators/:id/archive`)
1. **Validation & State Check:**
   - Target cannot be Super Admin ID 1.
   - Target must exist and have `role = 'admin'`.
   - **Duplicate/Stale Check:** If `target.archived_at !== null`, return HTTP 409 Conflict (`ALREADY_ARCHIVED`).
   - If client sends `expected_version` and it mismatches current `permissions_version`, return HTTP 409 (`CONCURRENCY_CONFLICT`).
2. **Atomic Execution:**
   - Set `is_active = 0`, `archived_at = datetime('now')`, `archived_by_admin_id = req.user.id`, `archive_reason = reason.trim()`, `token_version = token_version + 1`.
   - **Invalidate Reset Tokens:** `DELETE FROM password_reset_tokens WHERE user_id = targetId` and `password_reset_pending = 0`. Outstanding reset links become instantly and permanently invalid.
   - Invalidate sessions: `DELETE FROM sessions WHERE user_id = targetId`.
   - Invalidate MFA challenges: `UPDATE mfa_login_challenges SET consumed = 1 WHERE user_id = targetId`.
   - Record audit log:
     - `module: 'admin_management'`
     - `action: 'archive_administrator'`
     - `resource: 'admin:<id>'`
     - `outcome: 'success'`
     - `before_state`: `{ is_active: target.is_active, archived_at: null }`
     - `after_state`: `{ is_active: 0, archived_at: <now>, archived_by: req.user.id }`
     - `details`: `{ reason: reason.trim(), previous_status: target.is_active }`
3. **Real-time Disconnection:**
   - `securityEvents.emit('revoke_user', { userId: targetId })` immediately terminates all active WebSocket connections.

### 5.3 Restore Flow (`POST /api/admin/administrators/:id/restore`)
1. **Validation & State Check:**
   - Target cannot be Super Admin ID 1.
   - Target must exist and have `role = 'admin'`.
   - **Duplicate/Stale Check:** If `target.archived_at === null`, return HTTP 409 Conflict (`NOT_ARCHIVED`).
2. **Atomic Execution:**
   - Set `archived_at = NULL`, `restored_at = datetime('now')`, `restored_by_admin_id = req.user.id`, `restore_reason = reason.trim()`.
   - **Crucial Invariant:** Account is restored as **`is_active = 0` (INACTIVE)**.
   - Old sessions and tokens remain deleted and revoked. No reset tokens are restored.
   - Record audit log:
     - `module: 'admin_management'`
     - `action: 'restore_administrator'`
     - `resource: 'admin:<id>'`
     - `outcome: 'success'`
     - `details`: `{ reason: reason.trim(), restored_status: 'inactive' }`
3. **Explicit Activation Requirement:**
   - To resume access, Super Admin must review assigned permissions in the UI and separately make an activation request (`PATCH /api/admin/administrators/:id/status`).

### 5.4 Guarding Activation Endpoints Against Archived Accounts
In `PATCH /api/admin/administrators/:id/status` (`server/routes/admin-management.js:1340`):
```javascript
if (targetUser.archived_at !== null) {
  recordFailedAuditLog(req.user.id, targetId, 'update_status', 'Attempted to activate an archived administrator', req.ip);
  return res.status(400).json({ 
    error: 'Cannot activate an archived administrator. The account must be restored by Super Admin first.', 
    code: 'ACCOUNT_ARCHIVED' 
  });
}
```

---

## 6. Super Admin-Initiated Password Reset Subsystem

### 6.1 Requirements & Safeguards
- **Super Admin Only:** Strictly enforced via `requireSuperAdmin` and `requireRecentAuth`.
- **Target Restriction:** Target cannot be Super Admin (ID 1). Super Admin manages own credentials through the existing self-service recovery flow.
- **Target Cannot Be Archived:** If `target.archived_at !== null`, reset initiation is blocked (`ACCOUNT_ARCHIVED`).
- **No Password Exposure:** No existing password is ever decrypted, viewed, or exposed.
- **No Side-Effects on Status:** Initiating or completing a reset does not reactivate an inactive account or modify existing permissions.

### 6.2 Reset Initiation Flow (`POST /api/admin/administrators/:id/reset-password`)
1. **Pre-flight & Sudo Verification:**
   - Validates `req.user` is Super Admin and has recent authentication within 15 minutes.
   - Target must be a non-Super Admin administrator.
   - Super Admin must submit `reason` and target identity confirmation (`confirm_username` matching target's username).
2. **Atomic Token Generation & Revocation:**
   - Generates a cryptographically secure random token (256-bit entropy via `crypto.randomBytes(32).toString('hex')`).
   - Token payload signed as JWT with `expiresIn: '30m'`, `type: 'admin_password_reset'`, `userId: target.id`, `token_version: target.token_version + 1`.
   - Token hash: `crypto.createHash('sha256').update(rawToken).digest('hex')`.
   - Expires at: `Date.now() + 30 * 60 * 1000` (Dhaka-compatible ISO timestamp).
   - In an atomic transaction:
     - `DELETE FROM password_reset_tokens WHERE user_id = target.id` (any existing link is immediately invalidated).
     - `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`
     - `UPDATE users SET password_reset_pending = 1, password_reset_requested_at = datetime('now'), password_reset_requested_by = ?, token_version = token_version + 1 WHERE id = ?`
     - `DELETE FROM sessions WHERE user_id = target.id`
     - `UPDATE mfa_login_challenges SET consumed = 1 WHERE user_id = target.id`
     - Record audit log: `action: 'admin.reset_password_initiated'`, `target_user_id: target.id`, `details: { reason }`.
   - `securityEvents.emit('revoke_user', { userId: target.id })` to disconnect sockets.
3. **Delivery Attempt & Secure Fallback:**
   - URL generated: `${baseUrl}/admin/reset-password/${target.id}/${rawToken}`.
   - Attempt `sendPasswordResetEmail(target.email, resetLink)`.
   - **Case A: Email Delivery Succeeds:**
     - Return `{ success: true, delivery: 'email', message: `Password reset link successfully sent to ${target.email}.` }`.
   - **Case B: Email Delivery Fails or SMTP Unconfigured:**
     - Record failure in audit log (`outcome: 'success'`, `details: { delivery: 'direct_link', email_failure: true }`).
     - Return `{ success: true, delivery: 'direct_link', resetLink, warning: 'Email delivery failed. Copy this one-time link and deliver it securely to the administrator. It will not be shown again.' }`.
     - UI presents a single-view modal with a secure copy button.

### 6.3 Password Replacement Flow (`POST /api/admin/reset-password/:id/:token`)
1. **Validation:**
   - Validates `password` against verified policy regex (`validatePassword`).
   - Verifies JWT token structure and signature.
   - Hashes `token` with SHA-256 and queries `password_reset_tokens`:
     `SELECT id FROM password_reset_tokens WHERE user_id = ? AND token_hash = ? AND datetime(expires_at) > datetime('now')`.
   - If not found or expired: Return HTTP 400 (`code: 'INVALID_OR_EXPIRED_RESET_LINK'`).
   - Target user must exist and have `deleted_at IS NULL`.
   - **Archived Guard:** If `user.archived_at !== null`, return HTTP 400 (`ACCOUNT_ARCHIVED`).
2. **Atomic Consumption & Password Replacement:**
   - Runs in `db.transaction()`:
     - Atomically consume token: `DELETE FROM password_reset_tokens WHERE user_id = ? AND token_hash = ?`. If `changes === 0`, race condition lost -> return HTTP 400 (`TOKEN_ALREADY_USED`).
     - Hash new password: `bcrypt.hashSync(password, 12)`.
     - Update account:
       ```sql
       UPDATE users 
       SET password_hash = ?,
           password_reset_pending = 0,
           password_reset_requested_at = NULL,
           password_reset_requested_by = NULL,
           token_version = token_version + 1,
           updated_at = datetime('now')
       WHERE id = ?
       ```
       *(Note: `is_active` is NOT altered; if account was inactive, it remains inactive).*
     - Revoke all remaining sessions and MFA challenges.
     - Record audit log: `module: 'security'`, `action: 'admin.reset_password_completed'`, `target_user_id: user.id`.
3. **Post-Reset Access:**
   - Admin can now log in using the new password.
   - If the account has 2FA enabled, they are prompted for their TOTP code as usual. MFA is never bypassed.
   - If the account was inactive, login continues to be rejected until Super Admin activates it.

---

## 7. History Retention & Export Subsystem

### 7.1 Retention Policy Specification
1. **Preservation of History:** Archiving an administrator does not delete or alter any audit logs, permission changes, batch assignments, created courses, graded student assignments, or fee transactions.
2. **Honest Historical Boundaries:** The application records historical events starting from the implementation date of respective logging subsystems. Prior events are not fabricated. Creator attribution displays `"Unknown/Legacy"` when `created_by_admin_id IS NULL`.
3. **No Automatic Purges:** There is no automatic time-to-live expiration or disposal of administrative audit records in this release.

### 7.2 Multi-Cycle Archive/Restore Accountability Timeline
In `GET /api/admin/administrators/:id/accountability-profile`:
- Queries all audit records where `target_user_id = ?` and `action IN ('archive_administrator', 'restore_administrator')` ordered by `id ASC`.
- Builds a dedicated **Archive & Restoration Lifecycle Timeline** displaying every past archive/restore cycle with:
  - Cycle number
  - Action (`archive` or `restore`)
  - Timestamp (Dhaka time)
  - Operator (actor username, email, ID)
  - Recorded Reason

### 7.3 Audited Export Subsystem (`GET /api/admin/administrators/:id/export-history`)
- **Server Authorization:** `authenticateToken`, `requireSuperAdmin`, `requireRecentAuth`.
- **Query Parameters & Filters:**
  - `module`: Filter by module (`admin_management`, `security`, `students`, `academic`, etc.) or `'all'`.
  - `outcome`: Filter by `'success'`, `'failed'`, `'denied'`, or `'all'`.
  - `startDate`, `endDate`: ISO date boundaries.
  - `direction`: `'performed'` (`actor_id = id`), `'received'` (`target_user_id = id`), or `'all'`.
  - `format`: `'csv'` or `'json'`.
- **Hard Limit:** Maximum **5,000 records** per export to protect against memory exhaustion. Truncation is indicated in response headers (`X-Export-Truncated: true`).
- **Sensitive Data Exclusion:**
  - Database projection strictly selects non-sensitive columns.
  - All audit `details`, `before_state`, and `after_state` payloads are scrubbed via `redactSensitiveData()` to remove passwords, tokens, MFA secrets, and recovery codes.
- **CSV Formula Injection (CSV Injection / DDE) Defense Algorithm:**
  Spreadsheet applications (Excel, Calc, Sheets) execute formulas if a cell starts with `=`, `+`, `-`, `@`, `\t`, or `\r`. Attackers often evade simple checks by prepending spaces, quotes, or control characters.
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
- **Audit Logging:** Every export request logs an entry in `admin_audit_logs`:
  `action: 'export_administrator_history'`, `module: 'admin_management'`, `details: { target_admin_id, format, record_count, filters }`.

---

## 8. User Interface Architecture (Admin Management)

### 8.1 Views & Navigation
In `src/pages/admin/AdminManagement.jsx`:
- **Dual Tab Architecture:**
  - Tab 1: **Current Administrators** (Lists all active and inactive admins; excludes archived admins).
  - Tab 2: **Archived Administrators** (Lists all archived former admins).
- **KPI Summary Cards (Mutually Exclusive, Accurately Labeled):**
  - **Total Current Admins:** Counts all admins where `deleted_at IS NULL AND archived_at IS NULL` (includes Super Admin).
  - **Active Admins:** Counts current admins with `is_active = 1`.
  - **Inactive Admins:** Counts current admins with `is_active = 0`.
  - **Archived Admins:** Counts former admins where `deleted_at IS NULL AND archived_at IS NOT NULL`. Clearly labeled: *"Former administrators preserved for accountability; not included in current totals."*

### 8.2 Archived Admins View
- Search by username, full name, or email.
- Filter and pagination.
- Table columns:
  1. **Administrator Identity:** Profile picture, Full Name, Username, Email, stable Admin ID badge.
  2. **Archived Date:** Formatted in Dhaka Time (e.g. `28 Oct 2026, 04:30 PM`).
  3. **Archived By:** Name and username of the Super Admin who archived the account.
  4. **Reason:** Stored archive justification.
  5. **Actions:**
     - **View Profile:** Opens deep accountability profile with dual timelines, archive lifecycle, and security events.
     - **Export History:** Opens export filter dialog (CSV/JSON).
     - **Restore Admin:** Prompts for restore confirmation and reason.

### 8.3 Modals & Interaction Flows
1. **Archive Admin Modal:**
   - Displays clear warning: *"Archiving revokes all access, terminates active sessions, and moves the administrator out of the active list while preserving all historical records and accountability logs."*
   - Requires mandatory Reason (min 5 chars).
   - Requires Sudo Password verification.
2. **Restore Admin Modal:**
   - Displays notice: *"Restoring will return this administrator to the current list as INACTIVE. You must review their permissions and explicitly activate them before their access resumes."*
   - Requires Reason and Sudo Password verification.
3. **Reset Password Modal:**
   - Displays target administrator details and registered email.
   - Note on email verification: *"Note: BFI Classroom emails are registered at creation. Please verify this address belongs to the administrator."*
   - Requires Sudo Password verification.
   - If email delivery fails, transitions to a **Secure Link Display Modal** with copy button and warning: *"Email could not be delivered. Copy this single-use link and transmit it securely. It expires in 30 minutes and will not be displayed again."*

---

## 9. Comprehensive Testing & Verification Plan

### 9.1 Test Isolation & Safety
- **Strict Guard:** All tests run exclusively against disposable, isolated SQLite databases using `tests/test-db-isolation.js` or in-memory SQLite fixtures.
- **No Production Modification:** Production database `server/bfi_classroom.db` is never touched by tests.

### 9.2 Automated Test Scenarios (`tests/admin-archiving-and-reset.spec.js`)

1. **Access Blocking During Password Reset:**
   - Reset initiated -> `password_reset_pending` set to 1.
   - Verify `authenticateToken` rejects with HTTP 403 (`PASSWORD_RESET_PENDING`).
   - Verify `/api/auth/login` rejects with HTTP 403.
   - Verify `/api/auth/mfa-verify` rejects with HTTP 403.
   - Verify `/api/auth/refresh` rejects with HTTP 403 and clears cookie.
   - Verify socket handshake fails.
   - Complete password replacement -> verify `password_reset_pending` cleared to 0.
   - Verify inactive account remains inactive after password reset.

2. **Reset Token Lifecycle, Expiry & Superseding:**
   - Verify token expires after 30 minutes; expired token returns HTTP 400.
   - Initiate reset twice -> verify older token is deleted and cannot be used.
   - Concurrent token use simulation -> verify atomic consumption ensures only 1 caller succeeds.
   - Password replacement updates `token_version`, ensuring older tokens and sessions are dead.

3. **Archiving & Reset Link Invalidation:**
   - Generate reset link -> Archive admin -> verify reset link is deleted from DB.
   - Attempt to use reset link after archiving -> returns HTTP 400.
   - Restore admin -> verify reset link remains dead and cannot be reused.

4. **Archived Admin Access & Invariant Guards:**
   - Archive admin -> verify immediate session deletion and token rejection.
   - Verify archived admin cannot log in or refresh.
   - Attempt to call `PATCH /api/admin/administrators/:id/status` on archived admin -> verify HTTP 400 rejection (`ACCOUNT_ARCHIVED`).
   - Attempt to archive Super Admin (ID 1) -> verify HTTP 403 rejection.

5. **Restoration State & Concurrency:**
   - Restore archived admin -> verify `is_active === 0`.
   - Verify restored admin cannot log in until explicitly activated.
   - Archive already-archived admin -> verify HTTP 409 Conflict.
   - Restore non-archived admin -> verify HTTP 409 Conflict.
   - Stale optimistic concurrency conflict test.

6. **Audit Ledger & Rollback Integrity:**
   - Mock audit ledger failure -> verify archive transaction rolls back and admin remains unarchived.
   - Multiple archive/restore cycles -> verify audit log contains every event and accountability profile returns full cycle list.

7. **CSV Formula Injection Prevention:**
   - Export history with payload containing `=cmd|' /C calc'!A0`, `   +SUM(1+1)`, `\t@dangerous`, and `"  -2+3"`.
   - Verify every formula indicator is neutralized with `'` prefix and RFC-4180 escaped.

8. **KPI Counts & Non-Overlap:**
   - Create 1 super admin, 2 active admins, 1 inactive admin, 1 archived admin.
   - Verify counts: current = 4, active = 3, inactive = 1, archived = 1.
   - Mutually exclusive assertion: `active + inactive === current`.
