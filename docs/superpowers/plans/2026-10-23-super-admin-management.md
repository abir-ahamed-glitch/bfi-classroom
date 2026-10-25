# Super Admin Management & Permission Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Super Admin implementation in BFI Classroom with complete administrator account creation/management, fine-grained modular permission governance, real-time database-authoritative route enforcement, viewer-aware identity privacy, and full audit logging.

**Architecture:** A normalized permission model (`admin_permissions` and `admin_default_permissions`) paired with real-time middleware enforcement (`requirePermission`, `requireAnyPermission`) that queries SQLite with zero stale token delay. Viewer-aware API filtering ensures only administrators see Super Admin designations, while non-admins see ordinary Admin representations. A dedicated Super Admin interface in the existing design system provides administrator lifecycle controls, permission checklists, and audit inspection.

**Tech Stack:** Express.js, BetterSQLite3, React 18, Vite, Playwright, Tailwind / CSS variables.

**Spec:** User request specifying Super Admin account preservation, administrator creation/management, modular permission catalog, server-side route enforcement, audit history, viewer-aware identity privacy, and comprehensive isolated verification.

## Global Constraints
- Target Super Admin account: `admin@abir` / `k.eye.films@gmail.com`, stable user ID 1, `role = 'admin'`.
- Production database `server/bfi_classroom.db` must remain 100% untouched.
- All testing and fixtures run strictly on isolated test databases (`server/test_isolated_bfi.db` / in-memory).
- Zero git commits, zero git pushes, zero deployments, zero background service restarts without explicit permission.
- Viewer-aware identity privacy: Only administrators can see Super Admin status; non-admins (students, teachers, moderators, public) receive sanitized responses (`is_super_admin: 0`, `isSuperAdmin: false`) from the server.
- Existing ordinary administrators must retain full existing operational permissions upon migration; changing default permissions must never overwrite existing assignments.

## Review Focus
1. Ordinary admin attempts to call admin management APIs -> HTTP 403 Forbidden.
2. Restricted ordinary admin attempts to access unauthorized module (e.g. Finance or Trash) -> HTTP 403 Forbidden.
3. Permission revocation in DB takes effect on subsequent request using active JWT -> HTTP 403 Forbidden immediately.
4. Student or teacher requests profile/inbox/community data -> Response contains `is_super_admin: 0` and renders standard "Admin" badge.
5. Foreign key or validation failure in administrator creation/update -> Atomic rollback with no partial records.

---

### Task 1: Database Migration & Schema Setup
**Files:**
- Create: `server/db/migrations/20261023_admin_permissions.cjs`
- Modify: `server/db/database.js`
- Test: `tests/super-admin.spec.js`

- [x] Step 1: Create `admin_permissions` table (user_id, permission, granted_by, created_at, UNIQUE(user_id, permission)).
- [x] Step 2: Create `admin_default_permissions` table (permission PRIMARY KEY, is_default, updated_by, updated_at).
- [x] Step 3: Create `admin_audit_logs` table (id, actor_id, target_user_id, action, details, ip_address, created_at).
- [x] Step 4: Populate default permissions and migrate existing ordinary administrators (`id != 1 && role == 'admin'`) with full operational permissions to maintain backward compatibility.
- [x] Step 5: Wire migration into `server/db/database.js`.
- [x] Step 6: Verify migration execution on isolated test database.

---

### Task 2: Permission Catalog & Server-Side Enforcement Middleware
**Files:**
- Create: `server/config/permissions.js`
- Modify: `server/middleware/auth.js`
- Test: `tests/super-admin.spec.js`

- [x] Step 1: Define comprehensive permission catalog organized by existing modules (courses, batches, students, teachers, notices, communications, finance, reports, trash, settings) and actions (view, create, edit, publish, delete, export).
- [x] Step 2: Implement `requirePermission(permission)` and `requireAnyPermission(...permissions)` middleware in `server/middleware/auth.js`.
- [x] Step 3: Ensure Super Admin (ID 1, `role = 'admin'`, `is_super_admin = 1`) bypasses permission checks inherently.
- [x] Step 4: Ensure non-admins are rejected with HTTP 403.
- [x] Step 5: Ensure ordinary admins are verified in real time against `admin_permissions` table in the database.

---

### Task 3: Backend Administrator Management & Audit Routes
**Files:**
- Create: `server/routes/admin-management.js`
- Modify: `server/server.js`
- Test: `tests/super-admin.spec.js`

- [x] Step 1: Create `GET /api/admin/administrators` (Super Admin only, list all admins with assigned permissions).
- [x] Step 2: Create `POST /api/admin/administrators` (Super Admin only, create ordinary admin with bcrypt hash, enforce `admin@` username prefix, assign permissions, audit log).
- [x] Step 3: Create `GET /api/admin/administrators/:id` (Super Admin only, get admin details and permissions).
- [x] Step 4: Create `PUT /api/admin/administrators/:id/permissions` (Super Admin only, atomic update of permissions, reject if target ID is 1, audit log).
- [x] Step 5: Create `PATCH /api/admin/administrators/:id/status` (Super Admin only, activate/deactivate admin, reject if target ID is 1, audit log).
- [x] Step 6: Create `GET /api/admin/permissions/catalog` and `GET/PUT /api/admin/permissions/defaults`.
- [x] Step 7: Create `GET /api/admin/administrators/audit-logs`.
- [x] Step 8: Mount router in `server/server.js`.

---

### Task 4: Route-Level Permission Enforcement Across Modules
**Files:**
- Modify: `server/routes/admin.js`
- Modify: `server/routes/course-definitions.js`
- Modify: `server/routes/batches.js`
- Modify: `server/routes/trash.js`
- Modify: `server/routes/fee-tracker.js`
- Modify: `server/routes/student-export.js`
- Modify: `server/routes/broadcast.js`
- Test: `tests/super-admin.spec.js`

- [x] Step 1: Enforce `students:view`, `students:create`, `students:edit`, `students:delete`, `students:export` on `admin.js` and `student-export.js`.
- [x] Step 2: Enforce `teachers:view`, `teachers:create`, `teachers:edit`, `teachers:delete` on `admin.js`.
- [x] Step 3: Enforce `courses:view`, `courses:create`, `courses:edit`, `courses:publish`, `courses:delete` on `course-definitions.js`.
- [x] Step 4: Enforce `batches:view`, `batches:create`, `batches:edit`, `batches:delete`, `batches:results_upload` on `batches.js` and `admin.js`.
- [x] Step 5: Enforce `finance:view` and `finance:edit` on `fee-tracker.js` and fee endpoints.
- [x] Step 6: Enforce `trash:view`, `trash:restore`, `trash:delete_permanent` on `trash.js`.
- [x] Step 7: Enforce `communications:view`, `communications:send`, `communications:schedule`, `communications:delete` on `broadcast.js` and `admin.js`.
- [x] Step 8: Enforce `notices:view`, `notices:create`, `notices:delete` on `admin.js`.

---

### Task 5: Viewer-Aware Server Responses (Identity Privacy)
**Files:**
- Modify: `server/routes/student.js`
- Modify: `server/routes/inbox.js`
- Modify: `server/routes/community.js`
- Test: `tests/super-admin.spec.js`

- [x] Step 1: In `server/routes/student.js` (`/profile/:userId`), check `req.user?.role === 'admin'`. If not admin, sanitize `is_super_admin = 0` and `isSuperAdmin = false`.
- [x] Step 2: In `server/routes/inbox.js` (`/recipients` and `/users`), check `req.user?.role === 'admin'`. If not admin, sanitize `is_super_admin = 0` on all rows.
- [x] Step 3: In `server/routes/community.js` (posts, comments, reactors), check `req.user?.role === 'admin'`. If not admin, sanitize `is_super_admin = 0`.
- [x] Step 4: Verify admin viewers receive authoritative `is_super_admin = 1` for ID 1.

---

### Task 6: Super Admin Management UI
**Files:**
- Create: `src/pages/admin/AdminManagement.jsx`
- Create: `src/pages/admin/AdminManagement.css`
- Modify: `src/App.jsx`
- Modify: `src/components/Sidebar.jsx`
- Modify: `src/pages/admin/AdditionalOptions.jsx`
- Test: `tests/super-admin.spec.js`

- [x] Step 1: Create `AdminManagement.jsx` with Super Admin badge, administrators table, status toggles, and edit actions.
- [x] Step 2: Implement Add/Edit Administrator modal with modular permission matrix, grouped checkboxes, descriptions, and dependency handling.
- [x] Step 3: Implement effective access summary and review before saving.
- [x] Step 4: Implement Default Permissions tab and Audit Log tab.
- [x] Step 5: Register `/admin/administrators` in `App.jsx`, `Sidebar.jsx`, and `AdditionalOptions.jsx` visible exclusively to Super Admin.
- [x] Step 6: Verify responsive styling across dark and light modes.

---

### Task 7: Comprehensive Automated Verification & Regression Testing
**Files:**
- Modify: `tests/super-admin.spec.js`
- Test: Run Playwright test suites

- [x] Step 1: Test administrator creation with default vs custom permissions.
- [x] Step 2: Test individual permission grant and revocation taking immediate effect.
- [x] Step 3: Test restricted administrator receives HTTP 403 on unauthorized endpoints.
- [x] Step 4: Test immediate revocation with active token.
- [x] Step 5: Test prevention of self-escalation and unauthorized admin creation by ordinary admins.
- [x] Step 6: Test existing-account migration (all existing admins retain full operational access).
- [x] Step 7: Test viewer-aware identity privacy (admin sees Super Admin badge, student/teacher receives ordinary Admin identity).
- [x] Step 8: Test search and default Inbox consistency.
- [x] Step 9: Run complete regression suites: `course-definitions-api.spec.js`, `course-maker-e2e.spec.js`, `same-title-batch-collision.spec.js`.
- [x] Step 10: Run static code analysis (`npm run lint`) and production build (`npm run build`).

---

### Task 8: Documentation & Report
**Files:**
- Modify: `docs/reports/super-admin-implementation-report.md`

- [x] Step 1: Document architecture, permission catalog, and changed files.
- [x] Step 2: Document existing-admin migration behavior and default permission matrix.
- [x] Step 3: Document API enforcement, audit logging, and identity privacy coverage.
- [x] Step 4: Include exact test commands, exit codes, and verification evidence.
- [x] Step 5: Document rollback instructions, restart/re-login protocol, and Git status.
