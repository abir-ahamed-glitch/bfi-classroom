# Super Admin Deployment & Emergency Rollback Runbook

**Target System:** BFI Classroom Production Environment  
**Component:** Super Admin Multi-Admin Governance & Universal Two-Factor Authentication (2FA)  
**Document Status:** Production Operational Standard  
**Deployment Approval Status:** **STRICT NO-GO** (Local verification and rehearsal only; zero remote deployment authorized).

---

## 1. Governance & Separation of Approvals

To ensure operational safety, this runbook strictly bifurcates the release lifecycle into two independent gates:

1. **Publication Approval (Code & Artifact Quality Gate):**
   - Independent verification of immutable Git commit SHA.
   - 100% passing automated regression suites (SEC-01 through SEC-13, Super Admin Governance, Safe Spreadsheet Parsing, Rollback Fail-Closed).
   - Dependency vulnerability audit and documented threat triage.
   - Rehearsal execution across all lifecycle scenarios on disposable databases.
   - *Publication approval certifies that the codebase is technically sound and reproducible.*

2. **Deployment Approval (Live Environment Operations Gate):**
   - Scheduling within an authorized low-traffic maintenance window.
   - Operator readiness for zero-echo credential handoff.
   - Cloudflare 503 maintenance mode coordination.
   - Explicit confirmation of pristine production database hash and disk storage margins.
   - *Deployment approval authorizes live disruption, service stops, and schema migrations.*

---

## 2. Secrets & Encryption Inventory

The implementation consumes only specific, well-defined security environment variables. The operator must not invent or configure unsupported variables.

| Environment Variable | Purpose | Consuming Module | Lifecycle / Scope |
| :--- | :--- | :--- | :--- |
| `JWT_SECRET` | Primary HMAC key for signing and verifying short-lived access JWT tokens. | `server/config/security.js`, `server/routes/auth.js` | Rotated independently; revokes active user sessions when changed without backward compatibility. |
| `JWT_REFRESH_SECRET` | HMAC key for signing and verifying long-lived refresh tokens. | `server/config/security.js`, `server/routes/auth.js` | Rotated independently; revokes refresh capabilities. |
| `MFA_ENCRYPTION_KEY` | Dedicated AES-256-GCM symmetric key used to encrypt and decrypt TOTP secrets (`two_factor_secret`, `pending_two_factor_secret`). | `server/utils/totp.js`, `scripts/rotate_mfa_secrets.cjs` | Primary secret for column-level encryption in SQLite. |
| `PREVIOUS_MFA_ENCRYPTION_KEY` | Previous AES-256-GCM key used for seamless fallback decryption during key rotation. | `server/utils/totp.js`, `scripts/rotate_mfa_secrets.cjs` | Configured during rotation migration window until all secrets are re-encrypted. |
| `PREVIOUS_JWT_SECRET` | Legacy fallback key retained for backward compatibility with unmigrated installations. | `server/utils/totp.js`, `scripts/rotate_mfa_secrets.cjs` | Replaced by `PREVIOUS_MFA_ENCRYPTION_KEY`. |

> [!IMPORTANT]
> **No Whole-Database Encryption:** There is **NO generic database encryption key** (`DB_ENCRYPTION_KEY` or `DB_ENCRYPTION_KEY_PREVIOUS`). The application uses standard SQLite 3 with WAL mode; encryption is strictly applied at the column level for authenticator secrets via authenticated AES-256-GCM. Setting database-level encryption variables will have no effect on the application.

---

## 3. Pre-Disruption Prerequisites & Credential Preflight

Before executing any commands that alter live services or databases, the operator must verify all prerequisites:

1. **Target Commit Provenance:**
   - Must be an immutable 40-character Git commit hash (e.g. `1cd4b1b269be444a4141b1e1008d0a6c95ac7c94`). Mutable branch names (`main`, `HEAD`) are strictly rejected by the production runner in production mode.
2. **Cold-Start Tooling Extraction & Provenance:**
   - The canonical lifecycle runner automatically extracts all 6 critical tools from the approved `TARGET_COMMIT` into `server/.recovery_tools` outside git management:
     - `scripts/preflight_lockdown_check.cjs`
     - `scripts/verify_isolation.cjs`
     - `scripts/run_migrations.cjs`
     - `scripts/production_smoke_check.cjs`
     - `scripts/production_lifecycle.cjs`
     - `scripts/obtain_smoke_credentials.cjs`
   - The runner verifies SHA-256 checksums of each extracted tool against the target tree and executes a cold-start bundle load test in a clean Node subprocess before proceeding to service lockdown.
3. **Smoke Credential Preflight & Verification:**
   - **Supported Channel A (Confidential Interactive Handoff):** An interactive terminal (TTY) is attached or a programmatic credential provider is configured. The operator provides credentials on demand via zero-echo prompts during Phase 5 over loopback.
   - **Supported Channel B (Unattended Tokens):** `SUPER_ADMIN_TOKEN` and `ADMIN_TOKEN` (or `SUPER_ADMIN_TOKEN_FILE` and `ADMIN_TOKEN_FILE` with mode `0o600`) are supplied. Preflight performs:
     1. **Syntax, Expiration & Maintenance Buffer Verification:**
        - Enforces valid 3-part JWT format and requires a **finite numeric expiration claim** (`typeof exp === 'number' && Number.isFinite(exp)`). Non-numeric, NaN, or string expiration claims are strictly rejected.
        - Enforces a minimum **15-minute expiration buffer** (`exp - now >= 900s`). This buffer is strictly calibrated against the configured 15-minute deployment maintenance window, guaranteeing that unattended credentials do not expire midway through offline backup creation, asset building, schema migrations, or post-restart verification.
        - Enforces distinct administrative identities (`saPayload.id !== oaPayload.id`), verified Super Admin privileges for the primary token, and ordinary admin role for the secondary token.
     2. **Pre-Disruption Authenticated Verification & Failure Isolation:**
        - When unattended tokens are configured, the runner evaluates credentials against `GET /api/auth/me` on the live server before disruption.
        - **Explicit Authentication Rejection:** Any explicit failure (HTTP 401, 403, 404, or unverified admin role) is recorded immediately and **never masked** by subsequent timeouts or network resets. Deployment immediately halts in Phase 0.
        - **Ambiguity vs. Confirmed Downtime:** Confirmed service downtime requires unambiguous evidence on BOTH credential checks (`isSaRefused && isOaRefused`, meaning strict `ECONNREFUSED` on port 3001). Any mixed failure—such as the Super Admin request returning `ECONNREFUSED` while the Ordinary Admin request encounters `ETIMEDOUT`, `ECONNRESET`, or HTTP 5xx (or vice versa)—is strictly classified as an `ambiguous_failure`. Ambiguous failures immediately fail closed; they are **never** treated as permission for unattended deployment.
        - **Zero Service-Stop Guarantee on Preflight & Mixed Failure:** All preflight rejections (including syntax errors, missing buffer, explicit auth rejection, and mixed/ambiguous connection failures) occur in Phase 0 prior to issuing any service alteration commands (`systemctl stop nginx`, `pm2 stop`). The deployment halts immediately with **0 service-stop commands issued**, ensuring production services remain completely undisturbed during transient network partitions or socket timeouts.
   - **Strict Fail-Closed Rejection:** `SMOKE_SUPER_ADMIN_PASSWORD` is unsupported. Partial, expired, or malformed credentials throw an immediate fatal error in Phase 0. Fabricated authentication tokens are strictly forbidden; all access tokens must be authentically issued by the backend.

---

## 4. Canonical Deployment Procedure

The deployment is executed using positional action syntax (`deploy`):

```bash
# In an interactive operator terminal:
TARGET_COMMIT=<40-char-sha> node scripts/production_lifecycle.cjs deploy

# Or alternatively specifying target commit via flag:
node scripts/production_lifecycle.cjs deploy --target-commit <40-char-sha>

# Or running directly from the verified recovery bundle extracted from the target commit:
node server/.recovery_tools/production_lifecycle.cjs deploy --target-commit <40-char-sha>
```

### Phase Walkthrough & Safety Gates:

```
[Phase 0] Staging & Provenance Gate
  ├── Step 0.1: Validate smoke credential channel availability (Tokens or Interactive TTY)
  ├── Step 0.1.1: If unattended tokens: verify JWT claims, 15m expiration buffer, and live server GET /api/auth/me
  ├── Step 0.2: Extract 7 recovery tools from TARGET_COMMIT -> server/.recovery_tools (SHA-256 checked)
  ├── Step 0.3: Cold-start bundle load verification in clean Node process
  └── Step 0.4: Pre-flight working-tree conflict assessment & configuration preservation:
        ├── Fails closed on Git inspection failure or unapproved modified tracked files
        ├── Identifies approved reconcilable modifications (.env, package-lock.json)
        ├── Preserves effective configuration to attempt-bound backup (mode 0600, SHA-256 recorded)
        └── Leaves active .env and working-tree checkout completely untouched before shutdown

[Phase 1] Maintenance Mode & Writer Lockdown Gate
  ├── Step 1.1: Record pre-maintenance states in server/pre_deployment_services.env (Bound to ATTEMPT_ID)
  ├── Step 1.2: sudo systemctl stop nginx (Closes ports 80/443 to external traffic)
  ├── Step 1.3: pm2 stop bfi-classroom (Terminates background write processes)
  ├── Step 1.4: Run fail-closed isolation verify (ss, pgrep, connection drain check)
  └── Step 1.5: Run database handle inspection (wal_checkpoint(TRUNCATE), zero open handles via lsof)

[Phase 2] Dynamic Health Check & Validated Backup Gate
  ├── Step 2.1: Integrity check on live DB (PRAGMA quick_check, PRAGMA foreign_key_check)
  ├── Step 2.2: Capture table baseline counts -> server/pre_deployment_baseline.json
  ├── Step 2.3: Generate atomic online backup via better-sqlite3 .backup API (mode 0600)
  └── Step 2.4: Verify backup integrity, row counts, and record ATTEMPT_ID in active_backup_path.env

[Phase 3] Pinned Commit Checkout & Build Gate
  ├── Step 3.0: Reconcile approved tracked files (.env, package-lock.json) to HEAD baseline after verified lockdown
  ├── Step 3.1: git checkout <TARGET_COMMIT> (Enforce exact HEAD match)
  ├── Step 3.1b: Restore effective configuration from attempt-bound backup (mode 0600, assert SHA-256 bit-for-bit)
  ├── Step 3.1c: Assert working-tree cleanliness on target commit (0 modified tracked files)
  ├── Step 3.2: NODE_ENV=development npm ci --legacy-peer-deps (Installs devDependencies for build toolchain)
  ├── Step 3.3: npm run build (Compiles frontend production bundles into dist/)
  └── Step 3.4: npm prune --omit=dev --legacy-peer-deps (Prunes devDependencies for runtime isolation)

[Phase 4] Atomic Database Migration Gate
  └── Step 4.1: node server/.recovery_tools/run_migrations.cjs (Atomic single-transaction execution)

[Phase 5] Loopback-Isolated Smoke Verification Gate
  ├── Step 5.1: Verify Nginx remains stopped (Zero public ingress)
  ├── Step 5.2: pm2 start ecosystem.config.cjs (Isolated to 127.0.0.1:3001)
  ├── Step 5.3: Authenticated smoke verification:
  │     ├── If unattended: verify tokens against loopback GET /api/auth/me
  │     └── If interactive: bounded credential handoff via obtainSmokeCredentials over loopback
  ├── Step 5.4: Execute 18-assertion production smoke check over loopback
  └── Step 5.5: Securely zero-fill and unlink temporary token files

[Phase 6] Traffic Reopening Decision Point
  ├── Step 6.1: CRITICAL BOUNDARY: Persist trafficMayReopen=true & timestamp BEFORE exposure command!
  ├── Step 6.2: sudo systemctl start nginx (Restores public routing)
  ├── Step 6.3: Verify Nginx active status
  └── Step 6.4: Record trafficReopened=true (Operator deactivates Cloudflare 503)
```

---

## 5. Emergency Rollback Runbook

If any failure occurs during Phases 1 through 5 (e.g. migration error, build failure, smoke assertion failure), the canonical rollback routine is automatically triggered or may be invoked manually using the positional `rollback` action:

```bash
# Executing from the verified recovery bundle extracted from the target commit:
node server/.recovery_tools/production_lifecycle.cjs rollback

# Or from repository scripts:
node scripts/production_lifecycle.cjs rollback
```

### Safety Invariants & Rollback Gates:

1. **Attempt ID Binding:**
   - Rollback reads `server/active_deployment_state.json`, `server/active_backup_path.env`, and `server/pre_deployment_services.env`.
   - The `ATTEMPT_ID` across all three metadata files must match exactly. Rollback will strictly halt if an attempt mismatch is detected.
2. **Early-Failure Recovery (Before Validated Backup):**
   - If deployment failed in Phase 0 or Phase 1 before a validated backup was created, the live database was never touched!
   - The rollback routine will **skip database restoration** to prevent overwriting current data with an unrelated backup.
   - It persists `trafficMayReopen = true` and `trafficExposureInitiatedAt` before restoring Nginx.
3. **Traffic Exposure Boundary Gate:**
   - If `trafficMayReopen === true` or `trafficReopened === true`, automatic rollback is **STRICTLY REJECTED**.
   - Restoring a pre-deployment backup after external traffic was accepted would destroy legitimate student and administrative transactions.
   - Automatic restore halts. A manual forensic reconciliation plan must be approved, requiring `--allow-post-reopening-reconciliation`.
4. **Sidecar Quarantine & Atomic Restoration:**
   - Live database, WAL, and SHM sidecars are quarantined together into a timestamped directory `server/quarantine_YYYYMMDDHHMMSS`.
   - The validated backup is restored to the primary database path.
   - Restored database integrity and baseline row counts (`pre_deployment_baseline.json`) are verified before starting services.
   - Restores the original Git revision recorded in `pre_deployment_revision.txt`, runs `npm ci --legacy-peer-deps`, `npm run build`, and `npm prune --omit=dev --legacy-peer-deps`.
   - Restarts PM2, verifies loopback HTTP 200, sets `trafficMayReopen = true`, and restarts Nginx.
5. **Configuration Safeguard & Clashing Elimination (Step R.8):**
   - Before executing `git checkout <PREV_REV>`, the live configuration `.env` is moved aside to attempt-bound path `server/backups/env_rollback_aside_${ATTEMPT_ID}.env` (mode 0600).
   - This prevents Git checkout from aborting or silently clobbering `.env` with historical repository templates that previously tracked `.env`.
   - Immediately following checkout, the compatible configuration is restored from the validated attempt backup `envBackupFile` (or `rollbackEnvAside`), enforcing mode 0600 and asserting a bit-for-bit SHA-256 match against `preReconciliationEnvHash`.
   - The temporary aside copy is unlinked only after hash verification passes.

---

## 6. MFA Encryption Key Rotation Runbook

When rotating `MFA_ENCRYPTION_KEY`:

### Step 1: Rehearse on Disposable Data First
Run the rehearsal script to verify the rotation logic against synthetic data:
```bash
node scripts/rehearse_mfa_rotation.cjs
```
Ensure all 5 rehearsal steps pass with 100% success.

### Step 2: Production Dry-Run
Execute a dry-run against the production database to inspect accounts without writing changes:
```bash
PREVIOUS_MFA_ENCRYPTION_KEY="<current-key>" \
MFA_ENCRYPTION_KEY="<new-32-char-key>" \
node scripts/rotate_mfa_secrets.cjs --db=server/bfi_classroom.db --dry-run
```

### Step 3: Production Atomic Rotation
Execute the live re-encryption transaction:
```bash
PREVIOUS_MFA_ENCRYPTION_KEY="<current-key>" \
MFA_ENCRYPTION_KEY="<new-32-char-key>" \
node scripts/rotate_mfa_secrets.cjs --db=server/bfi_classroom.db
```

### Step 4: Environment Update & Service Restart
Update the production `.env` (or systemd environment) to set `MFA_ENCRYPTION_KEY` to the new key, and retain `PREVIOUS_MFA_ENCRYPTION_KEY` during the transition window. Reload PM2.
