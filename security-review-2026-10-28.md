# BFI Classroom security review — 28 October 2026

## Executive assessment

**Material security weaknesses were found. This is not a clean security sign-off.** Prioritise secret exposure, unauthenticated server-side fetching, executable uploads, sensitive profile responses, and authentication abuse controls before expanding privileged features or approving another release.

This review found no evidence of an actual intrusion. It does not establish that production has been compromised or that every local finding exists in the deployed release.

## Scope, evidence, and limits

- Reviewed local candidate: `E:/Antigravity/Project 2 - BFI Classroom/.worktrees/super-admin-integration`.
- HEAD observed: `b5903ce80000a30d0c8b1632194d7904de8a9cc3`.
- Uncommitted changes existed in admin-management.js and test-server.js at the start. The test specification also changed during review. This is a review of an evolving local checkout, not an immutable release certification.
- At the final status check, those changes had been committed externally as `824744fedd77631915dafea1be5bfcf91d27d81a` (`fix(security): enforce validated application url, fail-safe config validation, and hostile origin defense`), and the candidate working tree was clean. This reviewer did not create that commit. SEC-06 describes the separate self-service paths inspected in auth.js, not the corrected new admin-management URL helper.
- Read authentication, authorisation, MFA, recovery, demo frontend, public fetch endpoints, uploads, profiles, sockets, deployment workflow, secret configuration, and selected business routes.
- Researched current primary guidance from OWASP, NIST, Express, GitHub, Cloudflare, and package maintainers.
- Executed harmless extracted-code probes described below. No real account, production database, production endpoint, external internal-network target, or cloud metadata endpoint was attacked.
- Queried npm's advisory service for the lockfile's production dependency graph. No packages were installed or updated.
- Did not run the full application suites, reproduce browser account takeover, inspect production configuration, verify remote branch protections, or perform an exhaustive endpoint-by-endpoint penetration test.
- No application code, workflow, credentials, or production state was changed. The review outputs are this report and the npm advisory JSON in the workspace root.

Evidence labels: **EXECUTION-CONFIRMED** means the stated limited probe ran successfully; **SOURCE-CONFIRMED** means the code path exists; **CONDITIONAL** means deployment or exploit prerequisites remain unverified. Severity is a remediation priority, not a claimed measured CVSS score.

## Findings

### SEC-01 — Secrets are committed, and deployment can reintroduce an exposed SMTP credential

**Severity: High; potentially critical if production uses the committed signing keys. Status: SOURCE-CONFIRMED, production applicability CONDITIONAL.**

Locations: `.env:2`, `.env:3`, `.env:12`, `.env:18`; `.github/workflows/deploy.yml:45` and `:49`; `server/utils/totp.js:68`.

`git ls-files` confirms `.env` is tracked. A redacted inspection of `git show HEAD:.env` confirmed nonempty JWT signing, refresh signing, SMTP password, and Turnstile secret values; the corresponding working-file values match the committed values. Values were not copied into this report. The workflow still contains literal SMTP credential assignments and writes them into server environment files. Removing the email helper fallback alone did not remove the exposure.

Impact: anyone obtaining repository contents may obtain these credentials. JWT exposure threatens token authenticity, although current admin session checks impose additional constraints; it is not accurate to claim every forged admin token automatically succeeds. SMTP compromise can permit email abuse. Whether the keys match live production was not checked.

Remediation: have the authorised operator assess and rotate/revoke exposed credentials; remove tracked secrets and workflow assignments; store credentials outside source control; enable secret scanning and push protection; coordinate history cleanup without unapproved history rewriting. Rotate first, rather than assuming deleting source text invalidates a credential.

**Important dependency:** TOTP encryption derives its key from JWT_SECRET. Blindly changing that secret can make stored authenticator secrets unreadable. Plan a tested re-encryption/key-transition procedure or supervised recovery before rotation. Do not print the old or new keys. GitHub recommends revocation/rotation as the first response to exposed credentials. [GitHub guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)

### SEC-02 — Public link previews can reach internal server addresses

**Severity: High. Status: EXECUTION-CONFIRMED in an isolated extracted-handler probe.**

Locations: `server/server.js:193` onwards; image proxy at `:142`.

The link-preview handler accepts arbitrary HTTP/HTTPS targets and calls fetch without private-network or DNS-address validation. It is registered before authentication and the general API limiter. A controlled probe executed the actual extracted handler against a temporary loopback-only server: HTTP 200, one target hit, and the harmless target title returned. No application database was loaded.

The image proxy has a hostname regex, but lacks comprehensive address resolution and redirect validation. Checking the initial URL text does not prevent public names resolving to private addresses or redirects to internal services. Its response handling also accepts any image MIME subtype.

Impact: unauthenticated users can induce requests from the server into its local/private network. Data returned depends on target response format; this is not proof of arbitrary file access or cloud credential theft.

Remediation: authenticate where appropriate, apply limiting before both aliases, validate/pin resolved IPv4/IPv6 destinations, deny private/link-local/reserved destinations, revalidate each redirect or disable redirects, bound streaming response size and duration, and apply egress restrictions. [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

### SEC-03 — Executable uploads can be accepted and served from the application's origin

**Severity: High. Status: filter acceptance EXECUTION-CONFIRMED; complete browser attack not executed.**

Locations: `server/routes/certification.js:23–38`, `:44`; `server/routes/course.js:22–54`; `server/server.js:421–436`.

The certificate filter accepts a claimed `image/*` MIME regardless of filename extension, while storage preserves the extension. A probe of the actual filter accepted `audit-sentinel.html` labelled `image/png`. The certificate upload handler does not decode/re-encode the image before returning its public URL. Course upload validation also relies on claimed MIME while preserving the extension. Static uploads are served on the application origin, and the media middleware explicitly removes CSP and X-Frame-Options.

Impact: a user with the requisite upload permission may host executable HTML/SVG under the site's origin. Opening such content can threaten other users' browser data. A real malicious upload and victim browser execution were not performed. Existing upload authorisation limits who can introduce the file.

Remediation: verify content signatures and allowed extensions together; decode/re-encode images; reject active HTML/SVG unless a specifically secured use case requires them; use attachment downloads or a separate untrusted-file origin; retain suitable sandbox/CSP controls. Do not rely on a client-provided Content-Type. [OWASP upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

### SEC-04 — Other users' profile responses expose private academic and fee data

**Severity: High. Status: SOURCE-CONFIRMED plus extracted-handler fixture verification.**

Locations: `server/routes/student.js:95`, `:107`, `:142`, `:167`; enrollment schema in `server/db/database.js:127`.

Any authenticated user can request another profile. The handler loads `SELECT *` from student_course_enrollments and includes those enrollments in the non-admin response, independently of personal-field privacy controls. That table contains fee_details, exam results, and assignment scores. An extracted-handler test with different student IDs and a stub database confirmed fee and exam sentinels survive into the response. This used fixtures, not real student data.

Additionally, the admin branch returns the complete profile based on role alone, without the fine-grained `students:view` check used by the admin directory routes. A minimally privileged admin may therefore have an alternate path to sensitive student information.

Remediation: create explicit public/profile DTOs; exclude finance and academic details from other-user social profiles; enforce resource-level authorisation and required permissions before fetching restricted data. Test student-to-student, unrelated batch, instructor, and minimal-permission admin access. [OWASP authorisation guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)

### SEC-05 — Login/MFA throttling can be divided into attacker-controlled buckets

**Severity: High for MFA guessing protection. Status: SOURCE-CONFIRMED and key-generator behaviour EXECUTION-CONFIRMED; no guessing attack attempted.**

Locations: `server/middleware/auth.js:331–340`; `server/routes/auth.js:584`; `server/server.js:353–371`.

The auth limiter key combines IP with req.body.username. The MFA endpoint uses this limiter, but its challenge identifies the account independently of that arbitrary username field. Changing an irrelevant submitted username changes the limiter bucket: confirmed by executing the real key generator. No per-challenge failed-attempt counter was found in the reviewed MFA handler. Login spraying across many usernames also avoids a shared IP ceiling in this limiter.

The general limiter accepts the last 32 characters of any supplied Authorization header as its key before validating that header. Random invalid headers can therefore create fresh buckets. This is particularly relevant to public recovery endpoints without their own dedicated limiter. Public proxy endpoints precede this limiter entirely.

Remediation: independent trusted-IP limits, account limits, validated challenge-ID attempt budgets and expiry, sensible backoff, and pre-auth limits that cannot be reset by arbitrary headers. Keep limits for recovery, email verification, sudo verification, and socket messages. Test with actual middleware, not only key-generation assertions. [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

### SEC-06 — Self-service recovery still trusts Origin for link construction and reveals account existence

**Severity: High conditional link poisoning; Medium account enumeration. Status: SOURCE-CONFIRMED.**

Locations: `server/routes/auth.js:1178`, `:1217`, `:1295`, `:1348`, `:1450`.

Student/admin self-service recovery and verification use `CLIENT_URL || req.headers.origin || localhost`. If CLIENT_URL is unset, an attacker can influence the hostname in a real recovery email. An attacker still needs the recipient to follow that poisoned link; this is not automatic password theft. The new Super Admin reset helper was being corrected separately, but these older paths retain the fallback.

Recovery also distinguishes nonexistent accounts, admin/student roles, unverified addresses, and pending-reset state. Those differences let unauthenticated callers enumerate account status. Some login responses similarly expose state before checking the password.

Remediation: require one validated production application URL for all security links, reject invalid configuration, use generic public responses with comparable timing, and keep detailed failure causes only in protected logs. [OWASP password-recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)

### SEC-07 — Privileged password reset and history export can succeed without their required audit records

**Severity: High for accountability requirements. Status: SOURCE-CONFIRMED; fault injection not executed.**

Locations: `server/routes/auth.js:1506–1580`; `server/routes/admin-management.js:2158–2172` in the observed working tree.

The reset-completion transaction calls recordAuditLog with `throwOnError: false` inside a swallowed catch. The history export also records with `throwOnError: false`. These paths do not satisfy the agreed fail-closed audit requirement. A successful happy-path test does not prove rollback on audit failure.

Remediation: require audit success before committing credential replacement or releasing protected exports. Add tests injecting a real audit-write failure and checking the password, token consumption, and account state rollback. Distinguish delivery logs after SMTP from the atomic account operation: an external email cannot be undone by a database rollback.

### SEC-08 — WebSocket messages trust sender-supplied identity and destinations

**Severity: Medium. Status: SOURCE-CONFIRMED plus stub-transport execution.**

Locations: `server/server.js:616–690`.

The handshake authenticates a real user, which is good. However, call-request and related group/signalling handlers forward client payloads and target IDs without binding sender identity to socket.user or verifying conversation/call membership. A probe of the actual call-request callback confirmed an arbitrary callerId was forwarded unchanged. No real message was sent.

Impact: an authenticated user may spoof call metadata, send unwanted signalling, or interfere with call state. The reviewed code does not establish arbitrary reading of another conversation or automatic media interception.

Remediation: overwrite sender identity from authenticated state, validate event schemas and participant membership, authorise every destination, impose per-user/message budgets, and revalidate sessions during long-lived connections. Review origin restrictions and token expiry handling. [OWASP WebSocket guidance](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)

### SEC-09 — Access tokens are exposed to browser script and can enter export URLs

**Severity: Medium; higher impact when chained with XSS. Status: SOURCE-CONFIRMED.**

Locations: `src/context/AuthContext.jsx:180`, `:316`, `:358`; `server/routes/fee-tracker.js:372–379`; `server/routes/auth.js:63`.

Access tokens are stored in localStorage. The fee export accepts an access token in the URL query string. URLs can be captured in history, access logs, monitoring, and shared links. General-user access tokens default to 365 days, although current session checks can shorten effective validity for normally issued session-bound tokens. Admin access tokens are 15 minutes.

Remediation: remove bearer tokens from URLs; download through authenticated fetch or narrowly scoped short-lived download grants. Prefer short-lived access tokens held in memory and the existing protected refresh-cookie mechanism. Revalidate the XSS and CSRF implications of the chosen design. [OWASP browser-storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)

### SEC-10 — Known vulnerable packages remain in the production lockfile

**Severity: High remediation priority; individual exploitability CONDITIONAL. Status: EXECUTION-CONFIRMED advisory inventory.**

Command: `npm audit --omit=dev --package-lock-only --json`. npm exited **1**, reporting **48 affected-package entries: 2 critical, 37 high, 9 moderate**. Counts include transitive/metavulnerability propagation; they are not 48 independent exploitable application bugs. Full result: `security-audit-2026-10-28-npm.json` in the workspace root.

Examples requiring triage include pdfjs-dist, xlsx, multer, DOMPurify, Nodemailer, ws, sharp, tar, and proxy-addr. The app imports XLSX.read for admin-supplied files and pdfjs.getDocument in import components. PdfViewer references pdfjs-dist 3.11.174. The PDF.js maintainer documents arbitrary browser JavaScript execution in affected versions when isEvalSupported is true; no explicit false setting was found. Actual browser execution was not tested, and CSP/worker loading may affect reachability. [Maintainer advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq)

The critical proxy-addr advisory requires a particular trust-subnet configuration. The reviewed app uses numeric `trust proxy = 1`, so the advisory's critical rating alone does not prove that exact exploit applies. [Maintainer advisory](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)

Remediation: triage direct and reachable dependencies first, update compatible patched versions or replace unsupported packages, use maintainer workarounds where justified, and test imports, PDF viewing, uploads, mail and sockets. Do not blindly run `npm audit fix --force`.

### SEC-11 — Deployment workflow bypasses the reviewed release lifecycle

**Severity: High operational risk. Status: SOURCE-CONFIRMED, remote enforcement CONDITIONAL.**

Locations: `.github/workflows/deploy.yml:3–57`.

The tracked workflow deploys on pushes to main, executes git pull and npm install remotely, builds, and reloads PM2. It does not call the reviewed pinned-commit lifecycle with its database backup/isolation/migration/smoke gates. It also lacks a job environment approval declaration and explicit token permissions, and uses a tag-pinned third-party SSH action. Remote repository protections or disabled workflow status were not inspected, so an actual unapproved deployment was not established.

Remediation: align automation with the approved lifecycle and immutable release, add protected environment approval, least privilege, SHA-pinned actions, deterministic dependency installation, and audit deployment execution. Do not trigger this workflow as part of review. [GitHub Actions security guidance](https://docs.github.com/en/actions/reference/security/secure-use)

### SEC-12 — Unsafe production bootstrap and incomplete password-policy modernisation

**Severity: High conditional bootstrap risk; Medium password hardening gap. Status: SOURCE-CONFIRMED.**

Locations: `server/db/database.js:825–834`; `server/middleware/auth.js:393–396`.

If no admin exists, initialization creates a default admin using a hard-coded initial password. The password is deliberately omitted here. This branch was not executed. Existing production has an administrator according to prior reports, so this is primarily fresh-install, wrong-database, and disaster-recovery risk—not evidence of an active public default account.

The shared policy allows 8-character passwords with a narrow character whitelist and composition rules; no breached-password blocklist was found in the inspected paths. This is weaker than current guidance for password-only accounts. NIST distinguishes minimum 15 characters for password-only authentication from minimum 8 when used with MFA, and recommends against mandatory character-composition rules. [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)

Remediation: explicit one-time operator bootstrap with generated secrets and forced initial setup; no predictable default credential. Separately modernise password validation with long passphrases, reasonable maximum lengths accounting for bcrypt limits, breached/common-password rejection, and MFA. Do not unexpectedly invalidate all existing users' passwords.

## Demo access: what was actually found

`src/context/AuthContext.jsx:190–249` deliberately accepts arbitrary credentials on hostnames containing `github.io` and constructs a simulated student or admin with `demo-token`. This is a frontend-only preview shortcut.

An extracted authenticateToken JWT check, using a disposable audit signing key, rejected `demo-token` before any database call. No backend acceptance path for that marker was found in the reviewed authentication middleware. **Do not call this a verified production authentication bypass.**

Nevertheless, the hostname-substring rule is brittle. Prefer an explicit build-time demo mode, exact allowed preview origins, isolated mock transport, synthetic-only data, conspicuous branding, and no production tokens or APIs. The published demo and its network traffic were not opened or verified during this review.

## Additional hardening and open verification items

- HTTP and Socket.IO use permissive origin reflection. Bearer-based API auth and SameSite=Lax refresh cookies limit some cross-origin attacks; permissive CORS alone is not proof that any website can steal an admin session. Restrict origins and verify CSRF behaviour of cookie endpoints. [Express security guidance](https://expressjs.com/advanced/best-practice-security/)
- `trust proxy = 1`, direct server listen, and getClientIp's preference for forwarding headers must be checked against actual Nginx/Cloudflare routing. Untrusted clients must not be able to choose the audit or rate-limit IP. Production port exposure was not checked.
- Public image fetch buffers the entire response, request bodies allow 50 MB, sockets allow 10 MB, and preview caches have no hard entry bound. Limits and timeouts should cover streaming bodies and concurrent requests, not only initial response headers. No load or DoS test was performed.
- Certificate layout JSON flows to innerHTML/dangerouslySetInnerHTML without a visible sanitisation boundary. Restricted template editors can potentially introduce active markup. Treat as an additional XSS path requiring browser validation and safe rich-text allowlisting.
- Email verification confirmation is not authenticated in the reviewed new route, contrary to the approved normal-flow design. Bind confirmation to the intended authenticated account, exact current address, purpose, expiry, and atomically consumed challenge. No unauthorised account takeover through this route was established.
- Super Admin MFA is not yet universally enforced in the reviewed implementation; QR rendering and general-user account-settings MFA were still planned. The user-shared MFA setup screenshot exposes a setup secret and recovery codes: replace that factor/code set if used, and keep future evidence sanitised.
- Test-only endpoints are gated by test environment flags, and the isolated test entrypoint sets these flags deliberately. Verify production cannot start with these flags; do not mistake a test bypass for an established production bypass.
- Check logout/refresh/socket expiry behaviour across devices, stale sessions after password/MFA changes, audit completeness, and email-change reauthentication. Inline sudo password checks need their own bounded guessing protection; a limiter on a different verification endpoint does not automatically protect every inline path.
- Complete object-level tests for each student/batch/fee/course/attachment action. Several reviewed admin academic routes did have explicit permission and assigned-batch checks; this does not certify every route.
- Verify live TLS, headers, firewall, backups and restoration, dependency versions, repository visibility, branch rules, secret validity, abuse alerts, and production/database separation through an approved read-only operational review.

## Positive controls observed in source

- JWT signature checking and access-token purpose separation.
- Database-authoritative user role/status checks instead of trusting the frontend role alone.
- Strict administrator session and credential-version checks; short administrator access-token lifetime.
- Protected HttpOnly refresh cookies, server-side hashed refresh-token records, and session revocation paths.
- Server-tracked MFA login challenges, replay checks, encrypted TOTP secrets, and hashed single-use recovery codes.
- Many administration/finance routes have fine-grained permissions; selected moderator routes check batch assignments.
- Inbox attachment static access is blocked and an authorised attachment-serving path exists.
- New admin reset links use hashed, purpose-bound, expiring token records and fragment transport; archive/restore retains identity and history by design.

These are source observations, not a claim that every control passed integration testing during this review.

## Executed checks

| Check | Result | Limit |
|---|---|---|
| Extracted preview handler to temporary owned loopback server | Confirmed internal fetch: 200, one hit, sentinel title | Not the full production server; no database |
| First restricted-environment preview attempt | Failed to reach target: 500, zero hits | Repeated successfully with local-network permission |
| Actual auth-limiter key generator | Arbitrary username changes key | No real brute force or load |
| Actual certificate upload filter | HTML extension with claimed PNG accepted | No file persisted; no browser exploit |
| Extracted JWT middleware check with disposable key | demo-token rejected; zero DB calls | No production signing key used |
| Actual profile handler with stub DB | Other-user fee/exam sentinels returned | Synthetic fixture data only |
| Actual call-request callback with stub transport | Supplied caller identity forwarded | No real socket message |
| Committed secret inspection | Nonempty tracked keys confirmed, values redacted | Validity/live reuse unknown |
| npm advisory query | Completed; exit 1, 48 affected-package entries | Inventory, not exploitation proof |

No complete test-suite pass, security certification, production compromise, or absence of other vulnerabilities is claimed.

## Recommended order

1. Authorised operator assesses exposed keys and rotates with a safe MFA-key transition; prevent the workflow from reintroducing credentials.
2. Correct SSRF, active uploads, and private-profile data exposure. Verify whether those paths exist in the deployed release before choosing operational containment.
3. Strengthen MFA/login/recovery/sudo abuse controls, trusted recovery URLs, URL-token handling, and fail-closed audit behaviour.
4. Triage reachable vulnerable dependencies and align CI deployment with the canonical lifecycle.
5. Address socket identity, CORS/proxy configuration, bootstrap, password policy, demo isolation, and resource limits.
6. Run adversarial regression tests on an isolated environment, then an approved production configuration review. Use [OWASP ASVS](https://asvs.owasp.org/) as a verification checklist, without claiming compliance from this review alone.

Keep new multiple-Super-Admin and general-user MFA work separate enough that these security fixes can be reviewed and tested clearly. Do not deploy from this report without explicit release approval.

## Follow-up: feature-completion review at f40ff684c92a96799edf3e745398b35867c041d0

Gemini subsequently reported local completion of multiple Super Admins, universal MFA, and QR rendering, with 17 governance tests, 8 archiving tests, 88 existing Playwright tests, and a build passing. Those full suites were not independently rerun in this follow-up. The candidate working tree was observed clean at the revision above.

### SEC-13 — Initial universal MFA enrolment bypasses existing-factor replacement protection

**Severity: High. Status: EXECUTION-CONFIRMED with actual extracted handlers, an in-memory SQLite database, and real TOTP cryptography. No production or real account touched.**

Locations: `server/routes/auth.js`, handlers `/mfa/setup` and `/mfa/verify-setup` (approximately lines 1637–1748 at this revision).

The setup handler selects two_factor_enabled but does not reject an already-enrolled account. A logged-in caller who knows the password can create a new pending secret. The confirmation handler accepts a code for that new secret, replaces the live authenticator, and deletes/reissues recovery codes without proving possession of the existing factor.

The disposable fixture began with MFA enabled and a different existing secret. Setup returned 200; confirmation using the newly generated secret returned 200; the stored factor changed. No old authenticator code or old recovery code was supplied. Middleware was not exercised by this extracted-handler probe; its prerequisite is an already-authenticated session plus the password, not a password-only login bypass.

Remediation: make initial enrolment explicitly unavailable for already-enrolled accounts. Bind pending enrolment to user, session, credential version, purpose, and expiry; enforce state again at activation. Authorised replacement must independently prove and atomically consume an existing factor, and cannot reuse the initial-enrolment route. Test bypass attempts through both legacy and universal endpoints.

Additional source findings for the same security phase: universal pending setup stores only an encrypted secret without the promised expiry/session metadata; universal MFA disabling does not require the promised password verification; promotion/demotion handlers omit the requested explicit target confirmation and recorded reason; fresh-factor helper session checking is conditional when sessionId is missing, and its factor consumption uses weaker guards than the login flow. Recovery-table mirroring by numeric row ID requires review because independently generated tables need not retain corresponding IDs. These additional observations are not independently executed exploit claims.

Proceed to security remediation now, including SEC-13 first. Keep the existing SEC-01 through SEC-12 findings open until individually corrected and verified against the current revision. Do not regard happy-path suite success as proof that the new MFA bypass is absent.

## Remediation report review at 2a9d4beaa6fdf912c02693dc3162d71b00bd4733

**The claim that SEC-01 through SEC-13 are all VERIFIED is not supported.** Gemini reported passing Node suites and build, but its pasted execution history also shows failed Playwright attempts that are not represented in the final verification matrix. This reviewer did not rerun those full suites.

Independent regression probes against current extracted handlers confirmed:

- SEC-02 remains reproducible: public link-preview handler fetched an owned loopback sentinel, HTTP 200, one hit, sentinel returned. The new ssrf-filter helper is imported but is not called by the reviewed vulnerable fetch routes. The helper itself also classified expanded IPv4-mapped loopback `0:0:0:0:0:ffff:7f00:1` as public in an isolated unit probe. DNS validation is not pinned to the subsequent connection.
- SEC-03 remains reproducible: the current certificate upload filter still accepts an HTML filename labelled image/png. The new file-validator helper is not integrated into the reviewed certificate/course upload handlers. Tests of that helper alone do not prove those routes are safe.

Further source observations:

- The new security tests contain a literal copy of the previously exposed SMTP credential in negative-match assertions. Therefore “zero credentials in tests or Git history” is false. Do not reproduce that literal in reports or prompts; use synthetic fixtures and a proper secret scanner. Removing .env from HEAD does not revoke historical credentials.
- package.json and package-lock.json are unchanged between f40ff68 and the remediation HEAD. SEC-10 has been reduced to a subset of PDF loading calls; PdfViewer still lacks the reviewed isEvalSupported workaround. The dependency inventory finding remains open, even if one PDF path has a mitigation.
- The workflow still git-pulls, installs, executes migrations, builds, and reloads the live application without the reviewed canonical isolation/backup lifecycle. The actual workflow has no --dry-run, contrary to the report. environment: production does not itself prove that required-reviewer rules are configured remotely.
- The key-rotation utility defaults to the production database path, accepts secrets on command-line arguments, and rotates only two_factor_secret. Pending setup state and ciphertext-format transitions require explicit design and disposable-data rehearsal. Do not execute the report's production rotation instructions.
- Audit verification tests inspect source text rather than injecting database audit failures. Export and reset rollback behaviour must be executed before being marked verified.

Status: remediation is **PARTIALLY COMPLETED** and production release remains **NO-GO**. Prioritise connecting protections to actual routes, adversarial integration tests, safe key-transition tooling, dependency triage, honest report correction, and restoration of full browser regressions.
