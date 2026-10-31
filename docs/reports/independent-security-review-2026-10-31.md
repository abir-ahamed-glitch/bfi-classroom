# Independent security review — 31 October 2026

Scope: read-only inspection of release `67845474020a4b15d6a12ce5e20fb3fbddbe9470` and harmless public requests for nonexistent filenames. This is a focused review, not a full penetration test. No real user file was requested.

## High: alternate public path to report screenshots

`server/routes/reports.js:154-156` stores user-supplied report images in `uploads/report-screenshots` and returns `/uploads/report-screenshots/<filename>`. The new authenticated handler in `server/server.js:452-453` covers `/uploads/report-screenshots`, and Nginx blocks public static access on that path. However, `server/server.js:481-482` also mounts the entire `uploads` directory without authentication at `/media` and `/bfi-classroom/media`. Its explicit private-path block at line 437 covers only `inbox-attachments`, not `report-screenshots`. The committed Nginx patch contains no `/media/report-screenshots` block. A known report screenshot filename therefore appears retrievable without authentication through either `/media/report-screenshots/<filename>` or `/bfi-classroom/media/report-screenshots/<filename>`.

I checked nonexistent filenames on the live site: `/uploads/report-screenshots/nonexistent-audit.png` returned 401, while the two `/media/...` variants returned 200. The latter 200 responses may be the SPA fallback, so they do **not** establish that an existing image was disclosed. The source route mapping is the evidence for the access-control gap. Verify safely in isolated staging with a synthetic image, then restrict these alternate paths and test all aliases. Assess whether report screenshots require ownership or moderator authorization, since the current authenticated handler checks only that the requester is logged in.

## Medium: real-time signaling trusts client recipient and payload

`server/server.js:667-750` forwards call signaling to user rooms selected by client-supplied recipient IDs. Several group-call handlers forward `data` directly. Socket authentication is present (`server/server.js:538-588`), but these handlers do not establish that the sender and recipient are part of an authorized conversation or call. This can allow an authenticated user to send unwanted or misleading signaling to other users. Confirm client impact in isolated staging, then validate membership, recipient, event schema, and rate limits server-side.

## Limits and already identified work

This review did not test exploitability using real user files, perform disruptive production testing, or prove the absence of other vulnerabilities. Earlier fixes for CORS, inbox attachment aliases, proxy IP trust, and course-material deletion have been deployed according to Gemini's release report; their complete coverage remains unproven. Owner actions still pending in that report include revoking an exposed GitHub token, Super Admin MFA enrollment, Turnstile secret rotation, and test-account containment.
