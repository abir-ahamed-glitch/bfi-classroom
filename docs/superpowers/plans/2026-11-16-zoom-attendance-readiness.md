# Zoom Classroom and attendance readiness

Status: SDK iframe, join authorization, webhook receipt, and opt-in automatic attendance are implemented locally. They have not been verified together against a real Zoom meeting. The production configuration and rollout are still pending.

On 17 November 2026 (Bangladesh time), the headed Chromium rehearsal received the Zoom SDK success callback after joining a real BFI-hosted test meeting. It used simulated microphone and camera devices. The trace still recorded blocked stylesheet requests to `st1.zoom.us` and `us06st1.zoom.us` and a blocked nested frame to `zoom.us`; those did not prevent this join. Real audio/video transport, actual Zoom webhook delivery and automatic attendance from those events remain separate verification steps.

The webhook accepts signed Zoom participant join/leave events only when explicitly configured and enabled, validates the configured account, deduplicates normalized events and persists minimal unmatched receipts. It does not map participants to users or update attendance. Local tests use synthetic fixtures, not Zoom delivery. Retention and an operator review/processing workflow are still required before enabling it.

`zoomAttendanceEvidence.js` clips recorded intervals to the scheduled class, removes duplicates, adds overlapping intervals only once, and flags missing join or leave events. The Super Admin participant screen can retrieve this evidence for a verified enrollment with a current class binding. Evidence uses one Zoom participant ID and the current same-day Bangladesh class schedule. Zoom can change participant IDs across reconnects, so cross-ID reconciliation is still needed. This view does not write attendance.

`zoomIdentityMatch.js` is a tested preliminary matching guard: exactly one explicitly operator-verified mapping must match the precise meeting instance and participant ID. It is not a user interface or a source of verified mappings, does not establish identity itself, and does not update attendance. Authorization, exact enrollment and class membership must be independently verified at use time.

`zoomClassBinding.js` checks an explicit meeting instance binding against the current batch routine and Course Maker class. It rejects conflicting bindings, ambiguous slots and cancelled or moved occurrences. In Batch Manager, a Super Admin selects a phase and date, picks a scheduled class and recorded Zoom meeting, and links them. The underlying receipt API creates a binding using a recorded webhook receipt as the source of the Zoom meeting identity. GET revalidates the binding against the current routine. Bindings store who created them, are unique per meeting instance and schedule occurrence, and leave the receipt's attendance processing status unchanged.

After linking a meeting in Batch Manager, a Super Admin can open participant review. Independently verify the Zoom participant ID before choosing a student and confirming the match. Saving and resolving a match require a current class binding, an active student enrolled in that batch's course and access to the phase and class. To correct a match, select the participant, revoke the verification with a reason, then verify the correct enrollment. The database preserves who verified and revoked the original match and why.

A Super Admin can approve a present mark after viewing complete, positive recorded time for a verified participant. The server rechecks the identity and evidence, preserves any existing mark or excused absence, and commits the attendance, Course Maker progress and audit event together. Identity revocation leaves existing academic marks in the attendance sheet for explicit correction.

Automatic marking is off by default. In an isolated rehearsal, the job requires `ZOOM_AUTO_ATTENDANCE_ENABLED=true`, configured and enabled webhook receipt, and `ZOOM_AUTO_ATTENDANCE_FROM` set to the first eligible Bangladesh class date. It checks verified participants after the scheduled end, requires complete records and an explicit Course Maker minimum, and records only passing present marks. Existing attendance and exceptions are preserved, and the system audit action is `zoom_attendance_automatic`. Complete the live Zoom rehearsal before enabling the job on production.

`node scripts/test_zoom_attendance_integration.cjs` reproduces the local end-to-end test using an isolated database, real Express routes and signed provider fixtures. It tests a student join authorization, out-of-order webhooks, duplicate rejection, class linking, identity verification, the scheduled end boundary, and a single resulting mark and audit event. For the live rehearsal use a test enrollment and BFI-hosted test meeting on staging, verify actual Zoom delivery before enabling the automatic job there, and confirm the resulting academic record and audit entry.

Guarded staging reads Zoom variables only from its explicit staging environment file and clears inherited values, including automatic attendance flags. Staging database initialization requires the four Zoom tables to exist. Run `node scripts/test_zoom_staging_isolation.cjs` to verify that the staging process discards inherited Zoom settings.

The guarded gateway loads `.env.staging` or the file named by `STAGING_ENV_FILE` before loading the application. Run `node scripts/test_zoom_guarded_gateway.cjs` to verify the complete production-mode gateway on loopback, the Classroom frame policy, and both Zoom webhook paths with a signed synthetic endpoint challenge.

Course Maker phase requirements can set an optional minimum time per Zoom class as a whole percentage of the scheduled duration. Batch Manager shows whether the recorded time meets it. A configured threshold is enforced when approving attendance from Zoom and has no default for existing courses. This is separate from the percentage of classes required to pass a phase. The regular attendance sheet remains available for administrative exceptions.

The Zoom build now writes to `zoom-embed/dist` independently of the ordinary frontend build. A separate `npm run build:zoom` requires `npm ci --prefix zoom-embed --ignore-scripts` beforehand, and embeds `VITE_ZOOM_PARENT_ORIGIN` at build time. The local host uses `ZOOM_PARENT_ORIGIN` at runtime; the values must match. Production lifecycle integration, scoped CSP and iframe camera/microphone/storage behavior remain unverified. Do not enable `VITE_ZOOM_EMBED_ENABLED` or deploy this experimental path until these issues and real account-backed tests are complete.

## Separate HTTPS host rehearsal

- The standalone [Nginx configuration](../../infrastructure/nginx-zoom-embed.conf.example) uses a dedicated HTTPS hostname outside the Classroom cookie domain. This keeps third-party SDK code from setting cookies scoped to the Classroom domain. Proxy the host to the loopback listener using `ZOOM_PARENT_ORIGIN=https://classroom.bfibd.org npm --prefix zoom-embed start`. Manage that listener with the host's service supervisor. The listener needs only the built files and the parent origin. The Zoom secret belongs in the Classroom backend.
- Reproduce the local browser rehearsal by building with `VITE_ZOOM_PARENT_ORIGIN=https://classroom.test:48801` and running `node scripts/test_zoom_https_host.cjs`. The harness needs Playwright Chromium and OpenSSL on PATH or `ZOOM_TEST_OPENSSL`. Set `ZOOM_TEST_NGINX` to an Nginx executable to run the checked-in configuration with local listeners and a test certificate. The rehearsal passed with Nginx for Windows 1.30.6, including `nginx -t`, HTTP redirect, the SDK frame handshake, an unauthorized frame denial, and browser camera and microphone permissions with simulated devices. Public DNS and certificates, Linux Nginx on the target host, Zoom sign-in and media transport still need a rehearsal.
- Before a student-facing release, rehearse on a dedicated test hostname. Verify the certificate, Nginx configuration with `nginx -t`, the response `frame-ancestors` for the exact Classroom origin, and the Classroom response `frame-src` for the exact embed origin. Use an institution-hosted test meeting and a test enrollment to confirm join, audio, video, leave, and the external link fallback. Then repeat the hostname, certificate, and header checks through the public route before enabling the feature.

For a real Zoom join from the local rehearsal, start the test meeting in the same BFI Zoom account that owns the Meeting SDK app. The runner uses the [internal JWT participant flow](https://developers.zoom.us/docs/meeting-sdk/auth/). Run the following in a trusted PowerShell terminal from the repository after setting up Playwright Chromium. This verifies the SDK join callback. A second participant is still needed to verify audio and video transport.

```powershell
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    $env:ZOOM_TEST_OPENSSL = Join-Path $env:ProgramFiles 'Git\usr\bin\openssl.exe'
    if (-not (Test-Path -LiteralPath $env:ZOOM_TEST_OPENSSL)) { throw 'Set ZOOM_TEST_OPENSSL to the local OpenSSL executable' }
}
$env:VITE_ZOOM_PARENT_ORIGIN = 'https://classroom.test:48801'
npm run build:zoom
if ($LASTEXITCODE -ne 0) { throw 'Zoom build failed' }
$env:ZOOM_TEST_CLIENT_ID = Read-Host 'Meeting SDK client ID'
$env:ZOOM_TEST_MEETING_NUMBER = Read-Host 'Test meeting number'
$zoomSecret = Read-Host 'Meeting SDK secret' -AsSecureString
$zoomPasscode = Read-Host 'Test meeting passcode (Enter if none)' -AsSecureString
try {
    $env:ZOOM_TEST_CLIENT_SECRET = [pscredential]::new('zoom', $zoomSecret).GetNetworkCredential().Password
    if ($zoomPasscode.Length -gt 0) {
        $env:ZOOM_TEST_MEETING_PASSCODE = [pscredential]::new('zoom', $zoomPasscode).GetNetworkCredential().Password
    } else {
        $env:ZOOM_TEST_MEETING_PASSCODE = $null
    }
    node scripts/test_zoom_https_host.cjs --real-meeting
    if ($LASTEXITCODE -ne 0) { throw 'Zoom join rehearsal failed' }
} finally {
    $env:ZOOM_TEST_CLIENT_SECRET = $null
    $env:ZOOM_TEST_MEETING_PASSCODE = $null
    $zoomSecret.Dispose()
    $zoomPasscode.Dispose()
}
```

The first real-SDK browser test FAILED: the SDK requires sessionStorage, which the opaque-origin sandbox forbids. The prototype was revised to use a separate origin with strict origin-checked messaging. A subsequent local two-origin Chromium test loaded the real Zoom SDK and delivered a test join request; it did not join a Zoom meeting. Do not use the same origin, change the application-wide CSP or activate this prototype until hosting, scoped CSP, camera/microphone behavior and real account-backed tests are complete.

The two-origin local Chromium test additionally exercised a provisional, iframe-only CSP and verified its frame-ancestors response header. This is not a production Nginx configuration, does not prove all Zoom network resources are permitted, and does not verify real audio, video, screen sharing or a real meeting. The SDK build reports use of `eval`; evaluate the separately hosted origin's resulting security policy before any release.

Independent review identified a missing parent CSP allowance. The server now conditionally permits one explicitly configured, distinct HTTPS frame origin when `ZOOM_EMBED_ENABLED`, `ZOOM_PARENT_ORIGIN` and `ZOOM_EMBED_ORIGIN` are valid; default behavior remains unchanged. This policy has unit tests but has not been verified through production Nginx or Cloudflare. The regular deployment lifecycle neither installs nor builds nor publishes the separate iframe application; this remains a release blocker. Zoom join authorization currently has no time-window restriction; define and test the desired policy before production. Automatic attendance requires an owner-approved attendance policy and reliable verified participant identity, neither of which has been established.

## Existing behavior

The dashboard identifies a batch, phase, dated routine slot and opens that week's Classroom. A configured HTTPS meeting link opens an external meeting. Opening the link is not evidence that anyone joined or attended. Existing academic attendance is stored per `(enrollment_id, class_id)` in `student_class_attendance`; `recordClassAttendance` recalculates course progress. Routine slots may recur, change dates, or be ambiguous, so a slot identifier and date alone are not automatically an academic class identifier.

## Zoom constraints

- Zoom's [web component view](https://developers.zoom.us/docs/meeting-sdk/web/component-view/) is designed for desktop browsers. Zoom recommends client view for mobile; native-app fallback must also be evaluated on supported devices.
- A Zoom [participant-joined event](https://developers.zoom.us/docs/api/meetings/events/) reports a meeting instance UUID, but participant email can be absent for users outside the host account. Meeting-scoped participant IDs and display names are not durable identity credentials.
- A Zoom [webhook](https://developers.zoom.us/docs/api/webhooks/) requires a configured app, endpoint validation, event subscriptions, and HMAC verification using its secret. A valid signature establishes event origin, not that the participant belongs to a particular BFI account.

## Required design before enabling automatic attendance

1. Configure a Zoom Marketplace app under the institution's account and test required permissions, SDK authorization, subscription availability, account ownership, privacy terms, and mobile behavior. Keep secrets on the server; never log credentials or meeting passcodes.
2. Bind one exact Zoom meeting instance to one exact BFI batch, phase, scheduled date, routine slot and canonical Course Maker class ID. Reject missing, duplicate, cancelled, moved, or conflicting bindings; a meeting number alone is insufficient for recurring meetings. If an occurrence is moved, create or explicitly approve the new binding.
3. Establish a verified server-controlled mapping from a Zoom authenticated identity or registration record to exactly one active enrollment. Do not infer identity from a display name, email alone, or an untrusted client-provided customer key. Before relying on any SDK identifier, verify through Zoom documentation and an account-backed integration test that it cannot be asserted by another participant. Queue unknown or ambiguous cases for manual review.
4. Verify each webhook using Zoom's current documented secret/signature procedure and a strict timestamp policy before processing. Handle Zoom's endpoint validation separately. Deduplicate provider request IDs and normalized event identities durably, process join/leave events out of order, and retain only necessary metadata. A successful HTTP response must follow durable receipt, with a retry-safe processing queue.
5. Define an owner-approved attendance rule (for example, minimum time present) before automatic marking. Reconnects must merge intervals without double-counting; handle late events, missing leave events, room changes, cancellations and time zones. Unverified or incomplete evidence stays unmarked and available to an authorized admin for review.
6. Write through the existing attendance/progress service in an atomic transaction with an audit record. Track provenance and manual overrides separately. Never overwrite an admin's explicit correction or exception automatically; reconcile changes and show the reason to authorized staff.
7. Test signed/unsigned, stale, replayed, duplicated, malformed and out-of-order events, two students and two batches, guest join, identity conflicts, reconnects, manual overrides, cancellation, grade progression, database rollback, retries and real Zoom meetings on desktop and mobile before enabling. Confirm backup and retention requirements.

An SDK join or a click must never independently mark attendance. Until real event verification and identity matching are tested, continue using the existing manually managed attendance.
