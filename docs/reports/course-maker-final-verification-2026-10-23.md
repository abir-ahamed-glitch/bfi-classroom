# Course Maker final verification — 23 October 2026

Status: VERIFIED for the Course Maker workflows covered by the nine suites below, using Playwright Chromium and an isolated test database. This is an execution-backed scope statement, not a claim that every possible browser or input has been tested.

## Corrections made

### Routine edits accepted overlapping schedules

`PUT /api/admin/course-definitions/:id/routine` checked individual time ranges but did not reject overlap between slots on the same weekday. A new API regression test failed with expected HTTP 400 / actual HTTP 200 before the implementation changed.

The endpoint now rejects overlapping and malformed slots before writing overrides, draft definitions, or audit entries. Tests cover partial overlap, containment, duplicate slots, malformed values, draft and published definitions, and course-level and batch-level edits. Adjacent slots, unsorted valid slots, and equal times on different weekdays remain accepted. Published definitions remain immutable.

The regression passed after the correction and also passed in the final combined run.

### Immediate refresh could restore an older phase title

An intermediate combined run returned 108 passed / 1 failed: the Phase 2 title reverted to its default after editing and immediately reloading. Repeating that unchanged scenario eight times reproduced four failures and four passes.

Draft persistence in `CourseMaker.jsx` now uses a layout effect so each committed edit is cached before paint, rather than waiting for a deferred passive effect. No waits, retries, or relaxed assertions were added to the refresh test. The same scenario then passed eight out of eight repetitions, followed by a successful final combined run.

## Final execution evidence

| Suite | Passed |
| --- | ---: |
| Course Definitions API, including new routine validation regression | 12 |
| Course Maker E2E | 10 |
| Refresh persistence | 10 |
| Operational UI and grading | 9 |
| Fee resolver | 25 |
| Appreciation courses and batches | 9 |
| Responsive UI and lifecycle | 12 |
| Same-title batch isolation | 15 |
| Multi-batch integrity and migration | 7 |
| **Total** | **109** |

Final command, exit code 0, result **109 passed (4.1m)**:

```powershell
npx playwright test tests/course-definitions-api.spec.js tests/course-maker-e2e.spec.js tests/course-maker-refresh-persistence.spec.js tests/course-maker-operational-ui.spec.js tests/course-maker-fee-resolver.spec.js tests/course-maker-appreciation-and-batches.spec.js tests/course-maker-responsive.spec.js tests/same-title-batch-collision.spec.js tests/multi-batch-integrity-and-migration.spec.js
```

Final run output is saved locally in `test-results/course-maker-final-verified.log`. Automated responsive runs also regenerated the report screenshots.

- `npm run lint`: exit 0, zero errors, 152 existing warnings.
- `npm run build`: exit 0, built in 1.55 seconds; dependency direct-eval warning remains.
- `git diff --check`: exit 0.
- Production `server/bfi_classroom.db` SHA-256 matched before and after this work: `1f536e4cb06c82d4d34add148b326581f500f1bf39389062cfb879015a6d4e0b`.

## Proxy diagnostic and verification limits

A separate temporary Vite proxy diagnostic compared authenticated polling and WebSocket connections with deliberately aborted WebSocket upgrades. Normal connect/disconnect produced zero proxy errors. Twelve aborted upgrades produced 24 `ws proxy error` / `ws proxy socket error` log entries, reproducing the log pattern observed around browser navigation. Application logging was not suppressed and transports were not disabled.

The combined suite logs still include aborted-socket messages and missing-definition messages for disposable fixture enrollments. They are retained in the logs; no final test assertions failed. The production database was not used for mutating fixtures. Older unrelated repository suites that directly open the production database were not included in this audit.

These changes are saved locally. No deployment or production-service restart was performed.
