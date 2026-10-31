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
   - The canonical lifecycle runner automatically extracts all 7 operational tools and all target migration modules from the approved `TARGET_COMMIT` into `server/.recovery_tools` and `server/.recovery_tools/migrations` outside git management:
     - `scripts/preflight_lockdown_check.cjs`
     - `scripts/verify_isolation.cjs`
     - `scripts/run_migrations.cjs`
     - `scripts/production_smoke_check.cjs`
     - `scripts/production_lifecycle.cjs`
     - `scripts/obtain_smoke_credentials.cjs`
     - `scripts/rotate_mfa_secrets.cjs`
     - `server/db/migrations/*.cjs` (All canonical and schema repair migration modules)
   - The runner verifies SHA-256 checksums of each extracted tool and migration module against the target tree and executes a cold-start bundle load test in a clean Node subprocess before proceeding to service lockdown.
   - When running from `server/.recovery_tools/run_migrations.cjs`, migrations resolve strictly from `server/.recovery_tools/migrations/`. Missing or mismatched files fail closed immediately with zero fallback to historical working-tree modules.
   - Because `server/.recovery_tools/` is in `.gitignore`, no untracked files are placed in `server/db/migrations`, guaranteeing zero checkout conflicts during Phase 3.1.
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
4. **Cloudflare Maintenance Mode & Ingress Verification:**
   - **Required Permission Set:** Operator provides a scoped Cloudflare API token configured in environment or GitHub secrets:
     - Scope: `Zone: Zone: Read` + `Zone: Rulesets: Read` for zone `classroom.bfibd.org`.
     - Token must be strictly read-only, short-lived, and never committed to version control.
   - **Pre-Disruption Preflight (Before Phase 1 Lockdown):**
     - When Cloudflare maintenance page (HTTP 503) is engaged prior to shutting down services, verify active interception:
       ```bash
       node scripts/verify_cloudflare_maintenance.cjs --expect-state=active
       ```
     - A 503 response is treated as the maintenance page being active; the script prints the `Server` and `CF-Ray` headers so the operator can confirm the response is the Cloudflare-branded interstitial rather than an origin-generated error. The `--expect-state=inactive` check, which gates traffic reopening, is exact.
   - **Post-Deployment Pre-Traffic & Reopening Verification (Phase 6):**
     - After restoring live traffic (Step 6.4) and deactivating the Cloudflare 503 rule, verify normal public routing:
       ```bash
       node scripts/verify_cloudflare_maintenance.cjs --expect-state=inactive
       ```
     - Confirms public edge CDN returns `200 OK` from the application backend and is no longer intercepting traffic.

---

## 4. Canonical Deployment Procedure

The live production deployment is executed exclusively from the self-contained recovery bundle extracted into `server/.recovery_tools` from the approved target commit. Because the live checkout remains at historical revision `d4cbac1` prior to Phase 3.1, the runner must never be invoked from historical working-tree scripts (`scripts/production_lifecycle.cjs`).

### Step 4.0: Operator Cold-Start Bootstrap Extraction

Prior to invoking the runner, the operator extracts all 7 operational tools and all target migration modules from the fetched `TARGET_COMMIT` directly into `server/.recovery_tools` and `server/.recovery_tools/migrations` (which are ignored by `.gitignore`):

```bash
TARGET_COMMIT="<40-character-approved-sha>"

# 1. Create recovery directories
mkdir -p server/.recovery_tools/migrations

# 2. Extract the 7 operational tools directly from TARGET_COMMIT
for tool in \
  preflight_lockdown_check.cjs \
  verify_isolation.cjs \
  run_migrations.cjs \
  production_smoke_check.cjs \
  production_lifecycle.cjs \
  obtain_smoke_credentials.cjs \
  rotate_mfa_secrets.cjs; do
    git show "${TARGET_COMMIT}:scripts/${tool}" > "server/.recovery_tools/${tool}"
    chmod 0755 "server/.recovery_tools/${tool}"
done

# 3. Extract all migration modules directly from TARGET_COMMIT into server/.recovery_tools/migrations
for mig in $(git ls-tree --name-only "${TARGET_COMMIT}:server/db/migrations"); do
    git show "${TARGET_COMMIT}:server/db/migrations/${mig}" > "server/.recovery_tools/migrations/${mig}"
    chmod 0644 "server/.recovery_tools/migrations/${mig}"
done

# 4. Cold-start bundle integrity probe before launching
node -e '
  const path = require("path");
  const dir = path.resolve("server/.recovery_tools");
  const tools = [
    "preflight_lockdown_check.cjs",
    "verify_isolation.cjs",
    "run_migrations.cjs",
    "production_smoke_check.cjs",
    "production_lifecycle.cjs",
    "obtain_smoke_credentials.cjs",
    "rotate_mfa_secrets.cjs"
  ];
  for (const t of tools) require(path.join(dir, t));
  console.log("BUNDLE_BOOTSTRAP_VERIFIED_OK");
'
```

### Step 4.1: Single-Context Secret Generation & Deployment Execution

All three rotation secrets (`NEW_MFA_ENCRYPTION_KEY`, `NEW_JWT_SECRET`, `NEW_REFRESH_SECRET`) are generated, validated, passed to the runner, and wiped from memory within a **single controlled subshell execution context**. No secondary shell (`exec bash`) is used, and tracing remains strictly disabled:

```bash
(
  set -euo pipefail
  set +x

  cleanup() {
    unset NEW_MFA_ENCRYPTION_KEY NEW_JWT_SECRET NEW_REFRESH_SECRET
  }
  trap cleanup EXIT ERR INT TERM

  # 1. Generate 32-byte cryptographically secure random hex strings
  NEW_MFA_ENCRYPTION_KEY="$(openssl rand -hex 32)"
  NEW_JWT_SECRET="$(openssl rand -hex 32)"
  NEW_REFRESH_SECRET="$(openssl rand -hex 32)"

  # 2. Fail-closed length and format validation (zero disclosure)
  [ "${#NEW_MFA_ENCRYPTION_KEY}" -ge 32 ] || { echo "❌ FATAL: NEW_MFA_ENCRYPTION_KEY validation failed"; exit 1; }
  [ "${#NEW_JWT_SECRET}" -ge 32 ] || { echo "❌ FATAL: NEW_JWT_SECRET validation failed"; exit 1; }
  [ "${#NEW_REFRESH_SECRET}" -ge 32 ] || { echo "❌ FATAL: NEW_REFRESH_SECRET validation failed"; exit 1; }

  echo "✅ Fresh deployment secrets generated and validated in memory (zero disclosure)."

  export NEW_MFA_ENCRYPTION_KEY NEW_JWT_SECRET NEW_REFRESH_SECRET

  # 3. Launch the approved lifecycle runner directly from the verified recovery bundle
  node server/.recovery_tools/production_lifecycle.cjs deploy \
    --target-commit="<TARGET_COMMIT_SHA>" \
    --rotate-mfa
)
```

### Phase Walkthrough & Safety Gates:

```
[Phase 0] Staging & Provenance Gate
  ├── Step 0.1: Validate smoke credential channel availability (Tokens or Interactive TTY)
  ├── Step 0.1.1: If unattended tokens: verify JWT claims, 15m expiration buffer, and live server GET /api/auth/me
  ├── Step 0.2: Extract 7 recovery tools and all target migration modules -> server/.recovery_tools (SHA-256 checked)
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
  ├── Step 3.1: git checkout <TARGET_COMMIT> (Enforce exact HEAD match, 0 untracked conflicts)
  ├── Step 3.1b: Restore effective configuration from attempt-bound backup (mode 0600, assert SHA-256 bit-for-bit)
  ├── Step 3.1c: Assert working-tree cleanliness on target commit (0 modified tracked files)
  ├── Step 3.2: NODE_ENV=development npm ci --legacy-peer-deps (Installs devDependencies for build toolchain)
  ├── Step 3.3: npm run build (Compiles frontend production bundles into dist/)
  └── Step 3.4: npm prune --omit=dev --legacy-peer-deps (Prunes devDependencies for runtime isolation)

[Phase 4] Atomic Database Migration & Key Rotation Gate
  ├── Step 4.1: node server/.recovery_tools/run_migrations.cjs (Loads strictly from server/.recovery_tools/migrations/)
  └── Step 4.2: Atomic MFA key rotation & secure configuration update:
        ├── Resolves historical encryption key (MFA_ENCRYPTION_KEY or fallback JWT_SECRET)
        ├── Re-encrypts all TOTP secrets under NEW_MFA_ENCRYPTION_KEY in atomic transaction
        ├── Updates .env with new secrets (mode 0600) and asserts decryptability before exposure

[Phase 5] Loopback-Isolated Smoke Verification Gate
  ├── Step 5.1: Verify Nginx remains stopped (Zero public ingress)
  ├── Step 5.2: pm2 start ecosystem.config.cjs (Isolated to 127.0.0.1:3001)
  ├── Step 5.3: Authenticated smoke verification:
  │     ├── If unattended: verify tokens against loopback GET /api/auth/me
  │     └── If interactive: bounded credential handoff via obtainSmokeCredentials over loopback
  ├── Step 5.4: Execute 18-assertion production smoke check over loopback
  └── Step 5.5: Securely zero-fill and unlink temporary token files

[Phase 6] Traffic Reopening Decision Point (Automatic Reopening upon Smoke Passage)
  ├── Step 6.1: CRITICAL BOUNDARY: Persist trafficMayReopen=true & timestamp BEFORE exposure command!
  ├── Step 6.2: sudo systemctl start nginx (Automatically restarts Nginx upon smoke success; no prompt)
  ├── Step 6.3: Verify Nginx active status
  └── Step 6.4: Record trafficReopened=true (Operator deactivates Cloudflare 503)
```

> [!IMPORTANT]
> **No Interactive Checkpoint at Phase 6:** The approved lifecycle runner automatically sets the conservative boundary `trafficMayReopen = true`, starts Nginx, and restores external routing immediately upon successful completion of Phase 5 smoke assertions. There is NO manual prompt or pause before reopening. Final deployment approval explicitly includes authorization for this continuous, automatic reopening.

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

---

## 7. Security Notice: Historical GitHub Personal Access Token Revocation

> [!WARNING]
> **Action Required by Token Owner:**  
> A historical GitHub Personal Access Token (`ghp_...` belonging to account `mdkawsarahamed`) was previously present in workstation Git remote URLs.
>
> 1. **Workstation & Server Remediation (Completed):**
>    - The production server uses exclusively a dedicated, locked-down read-only SSH deploy key (`id_ed25519_bfi_deploy`, permissions `0600`) without embedded tokens.
>    - The local workstation Git remote URL has been sanitized to `https://github.com/mdkawsarahamed/bficlassroom.git`, stripping all credentials.
> 2. **Token Revocation (Outstanding Manual Action):**
>    - Because tokens can only be invalidated by the account that created them, the token remains cryptographically active on GitHub until manually revoked.
>    - The token owner (`mdkawsarahamed`) must log into GitHub, navigate to **Settings -> Developer Settings -> Personal Access Tokens**, identify the corresponding token, and click **Revoke** to permanently destroy it.


---

## 8. OCI Cloud Infrastructure Diagnostics & Environment Configuration

The diagnostic suites (`scripts/test_oci.cjs` and `scripts/test_oci_post.cjs`) probe Oracle Cloud Infrastructure (OCI) APIs using RSA request signatures (RFC draft-cavage-http-signatures-10 / OCI standard).

### Required Environment Variables
To execute live authenticated diagnostics without hard-coding secrets or tenancy identifiers in source control:

| Variable | Description | Source in OCI Console |
| :--- | :--- | :--- |
| `OCI_TENANCY_OCID` | Oracle Cloud Tenancy Identifier | **Tenancy Details** page (Profile -> Tenancy: `<name>`) |
| `OCI_USER_OCID` | IAM User OCID | **User Details** page (Profile -> User Settings) |
| `OCI_FINGERPRINT` | MD5 Fingerprint of the registered RSA key | **User Settings -> API Keys** table |
| `OCI_KEY_PATH` | Path to RSA private key PEM file | Local filesystem (default: `~/.oci/oci_api_key.pem`, permissions `0600`) |
| `OCI_REGION` | Target region endpoint (default: `ap-singapore-1`) | OCI Region Selector |

### Diagnostic Gate Assertions & Skip Convention
- **When environment variables are missing:** The test suites cleanly skip live API network execution and print:
  `Skipping live OCI API call — 0 assertions executed.`
  This prevents false CI failures on developer workstations while explicitly documenting zero assertions.
- **When credentials are configured:** The suites execute signed HTTPS requests and assert:
  1. OCI API accepts the signature authentication (HTTP non-401).
  2. The response body is valid, parseable JSON.
  3. The tenancy compartment query is handled by the OCI API.
  Any assertion failure results in non-zero exit code (`exit 1`).

---

## 9. Executable Production Lifecycle Handoff & Secret Rotation (§E3 Specification)

> [!IMPORTANT]
> **Production Deployment Gate Active:**  
> This lifecycle redeployment re-encrypts all user TOTP two-factor authentication secrets under a fresh MFA key and rebuilds the production web bundle. Run this only after owner authorization.

### Supported CLI Surface of `production_lifecycle.cjs`
The canonical interface supported by `server/.recovery_tools/production_lifecycle.cjs` (and `scripts/production_lifecycle.cjs`) is:
```bash
node server/.recovery_tools/production_lifecycle.cjs <deploy|rollback> [--target-commit <SHA>] [--rotate-mfa] [--previous-revision <SHA>] [--root-dir <PATH>] [--database-path <PATH>] [--env-path <PATH>]
```
> [!NOTE]
> Options `--new-mfa-key`, `--new-jwt-secret`, and `--new-refresh-secret` **do not exist as CLI flags**; passing them on the command line is silently ignored. The deployment tool reads the replacement MFA encryption key exclusively from the environment variable `NEW_MFA_ENCRYPTION_KEY`.

### Exact Execution Sequence

```bash
# ── ON THE PRODUCTION HOST (129.221.243.153) ─────────────────────────────────
ssh -i ~/.ssh/oracle_bfi ubuntu@129.221.243.153
cd /home/ubuntu/bfi-classroom

# 1. Fetch target commit from origin. The production host does NOT have it locally until fetched!
git fetch origin 11a1f1c7bfd64096bbe1821e78b26a6331dbf866
git cat-file -t 11a1f1c7bfd64096bbe1821e78b26a6331dbf866   # Must print: commit

# 2. Stage Cloudflare Turnstile keys in .env.
#    The site key is compiled into the client bundle at build time.
#    Retrieve the secret key from Cloudflare Dashboard (Account 18f46e7d161d0b8ef1b25ec8ea97e27d -> Turnstile -> classroom-turnstile).
sed -i 's|^CLOUDFLARE_TURNSTILE_SITE_KEY=.*|CLOUDFLARE_TURNSTILE_SITE_KEY=0x4AAAAAAFuM3vEclHqjSsKd|' .env
sed -i 's|^CLOUDFLARE_TURNSTILE_SECRET_KEY=.*|CLOUDFLARE_TURNSTILE_SECRET_KEY=0x4AAAAAAFuM3hOSHd9zKBIZLATGw-56rFU|' .env
sed -i 's|^VITE_CLOUDFLARE_TURNSTILE_SITE_KEY=.*|VITE_CLOUDFLARE_TURNSTILE_SITE_KEY=0x4AAAAAAFuM3vEclHqjSsKd|' .env
chmod 0600 .env

# 3. Pre-flight Turnstile secret validation against Cloudflare API:
curl -s -X POST https://challenges.cloudflare.com/turnstile/v0/siteverify \
  -d "secret=0x4AAAAAAFuM3hOSHd9zKBIZLATGw-56rFU" \
  -d "response=invalid-probe" \
  -d "remoteip=127.0.0.1"
# Required verification: Must return {"error-codes":["invalid-input-response"],"success":false,...}
# (i.e. secret accepted by Cloudflare, only the fake probe token is rejected).

# 4. Export NEW_MFA_ENCRYPTION_KEY.
#    `export` is mandatory because production_lifecycle.cjs reads the new key from environment only.
export NEW_MFA_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

# 5. Execute lifecycle deployment pinned to target commit:
node server/.recovery_tools/production_lifecycle.cjs deploy \
  --target-commit="11a1f1c7bfd64096bbe1821e78b26a6331dbf866" \
  --rotate-mfa
```

### User Impact Analysis
1. **User MFA Secrets Re-encrypted (No Re-enrolment):** Stored TOTP secrets in SQLite are re-encrypted under `$NEW_MFA_ENCRYPTION_KEY` via `scripts/rotate_mfa_secrets.cjs`. Users continue using their existing authenticator apps without interruption.
2. **Active User Sessions Retained:** `JWT_SECRET` and `JWT_REFRESH_SECRET` are not rotated by the default lifecycle command; logged-in user sessions remain valid and users are not logged out.
   *(Optional Operator Choice: If the owner explicitly desires all users to be logged out, export `NEW_JWT_SECRET` and `NEW_REFRESH_SECRET` before running the command).*
3. **Frontend Bundle Rebuild:** The deployment tool executes `npm ci` and `npm run build`, baking the new Turnstile site key `0x4AAAAAAFuM3vEclHqjSsKd` into `dist/assets/main-*.js`.
