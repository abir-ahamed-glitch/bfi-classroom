# PDF Engine Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the archived `@react-pdf-viewer` stack and vulnerable `pdfjs-dist@3.11.174` with `react-pdf@11.0.0` (viewer) + `pdfjs-dist@6.3.289` (text extraction), automating worker bundling via Vite `?url` imports.

**Architecture:** `react-pdf@11.0.0` provides `Document`/`Page` primitives for `PdfViewer.jsx` and ships `pdfjs-dist@6.3.289` as its own dependency. The three text-extraction components import `pdfjs-dist` directly (resolves to the same `6.3.289` instance). All four components register the worker via Vite's `?url` import — no manual static file. The stale `public/pdf.worker.min.js` (v3) is deleted after all consumers are migrated and verified.

**Tech Stack:** React 19.2.4, react-pdf@11.0.0, pdfjs-dist@6.3.289 (exact pin from react-pdf), Vite `?url` worker asset import, Playwright for browser tests.

**Spec:** `docs/superpowers/specs/2026-10-30-pdf-engine-modernization-design.md`

## Global Constraints

- `isEvalSupported: false` must be passed to every `getDocument()` call and to `Document options`
- `enableScripting` must remain `false` (pdfjs-dist v6 default; must not be enabled)
- `worker-src 'self' blob:` CSP must not be broadened; worker served from same origin only
- No CDN worker imports; no `--legacy-peer-deps`; no `overrides`/`resolutions` to force versions
- `public/pdf.worker.min.js` must not be deleted until Task 5 (all consumers verified)
- No push, merge, deploy, or production access
- All tests must use isolated synthetic DB + fixtures — no production data

## Review Focus

1. **Worker version mismatch at runtime:** If any consumer still references the old `pdf.worker.min.js` URL after migration, pdfjs-dist v6 will throw "API version X does not match Worker version Y" and silently fall back to fake worker. Task 3 pins the assertion `isWorkerDisabled === false` and worker URL contains `.mjs`.
2. **Multi-page PDF pagination in PdfViewer:** The new viewer must correctly advance and retreat pages via UI controls. Task 2 adds a multi-page fixture test asserting page count and navigation.
3. **Base64 API endpoint path in PdfViewer:** The `url.includes('/base64')` fetch + decode + revoke loop must survive the viewer rewrite. Task 2 tests the blob URL path with a mocked fetch.
4. **UploadResultsModal legacy import removal:** `pdfjs-dist/legacy/build/pdf` does not exist in v6; importing it must throw a build-time resolution error if not removed. Task 4 verifies the production build succeeds with no unresolved imports.
5. **Text selection in PdfViewer:** react-pdf requires explicit `TextLayer` inclusion; omitting it silently produces no selectable text. Task 2 asserts the TextLayer CSS is imported and the layer element is present in the DOM.

---

## Task 1: Install react-pdf@11.0.0, remove old packages, verify dependency tree

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (via npm)

**Interfaces:**
- Produces: `react-pdf@11.0.0` installed; `pdfjs-dist@6.3.289` in node_modules (single copy); `@react-pdf-viewer/core` and `@react-pdf-viewer/default-layout` absent from node_modules

- [ ] **Step 1: Run pre-migration audit baseline**

  ```bash
  cd "E:\Antigravity\Project 2 - BFI Classroom\.worktrees\super-admin-integration"
  npm audit --json > docs/superpowers/plans/audit-before.json
  ```

  Expected: exits 0 or non-zero (save output regardless).

- [ ] **Step 2: Install react-pdf@11.0.0**

  ```bash
  npm install react-pdf@11.0.0
  ```

  Expected: exits 0. No `--legacy-peer-deps`. No warnings about react-pdf peer conflict (it requires `react@^19.0.0`, project has `^19.2.4`).

- [ ] **Step 3: Remove archived packages**

  ```bash
  npm uninstall @react-pdf-viewer/core @react-pdf-viewer/default-layout
  ```

  Expected: exits 0.

- [ ] **Step 4: Verify pdfjs-dist resolved version**

  ```bash
  npm ls pdfjs-dist
  ```

  Expected: exactly one entry `pdfjs-dist@6.3.289`. No duplicate version entries. No `deduped` warnings indicating multiple versions.

- [ ] **Step 5: Verify removed packages are gone**

  ```bash
  npm ls @react-pdf-viewer/core @react-pdf-viewer/default-layout
  ```

  Expected: both show `(empty)` or error "not in tree".

- [ ] **Step 6: Verify react-pdf worker file exists in node_modules**

  ```bash
  ls node_modules/pdfjs-dist/build/ | Select-String "worker.min.mjs"
  ```

  Expected: `pdf.worker.min.mjs` is present.

- [ ] **Step 7: Commit dependency changes**

  ```bash
  git add package.json package-lock.json
  git commit -m "deps: install react-pdf@11.0.0, remove @react-pdf-viewer packages"
  ```

---

## Task 2: Rewrite PdfViewer.jsx

**Files:**
- Modify: `src/components/PdfViewer.jsx`

**Interfaces:**
- Consumes: `react-pdf` (`Document`, `Page`, `pdfjs`), `pdfjs-dist/build/pdf.worker.min.mjs?url`
- Produces: `PdfViewer({ url, name, containerStyle })` — same external prop API; internal viewer replaced; toolbar has page nav + zoom + download

- [ ] **Step 1: Write the failing test update for T7 in pdf-components-application.spec.js**

  Open `tests/pdf-components-application.spec.js`. Find test `'7. PdfViewer: real component mounts...'`. Update the viewer container selector from `.rpv-core__viewer` to `.react-pdf__Document`:

  ```js
  const viewerContainer = page.locator('.react-pdf__Document');
  await expect(viewerContainer).toBeVisible({ timeout: 20000 });
  ```

  Also update the `isEvalSupported` check — in react-pdf v11 + pdfjs-dist v6, `isEvalSupported` is passed via `Document options`; the `GetDocRequest` worker message check should still work. Keep the existing worker message assertion.

- [ ] **Step 2: Run T7 to confirm it currently fails (old selector)**

  ```bash
  npx playwright test tests/pdf-components-application.spec.js --grep "PdfViewer: real component" --reporter=line
  ```

  Expected: FAIL (`.react-pdf__Document` not found because PdfViewer still uses old viewer).

- [ ] **Step 3: Implement new PdfViewer.jsx**

  Replace the file content. Preserve: `{ url, name, containerStyle = {} }` props, `isMounted` guard, base64 fetch/decode/revoke logic, error state with `<h3>Failed to Load PDF</h3>`, loading state with "Decoding PDF secure payload...", `onClick={e => e.stopPropagation()}`, outer div with existing inline styles.

  Worker setup (at module level, before the component):
  ```js
  import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
  import { Document, Page, pdfjs } from 'react-pdf';
  import 'react-pdf/dist/Page/AnnotationLayer.css';
  import 'react-pdf/dist/Page/TextLayer.css';

  pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
  ```

  State additions inside component: `numPages` (int, null), `pageNumber` (int, 1), `scale` (float, 1.0).

  Toolbar row (rendered when `!loading && !error && resolvedUrl`), above `<Document>`:
  - Previous page button: disabled when `pageNumber <= 1`
  - Page indicator: `{pageNumber} / {numPages || '—'}`
  - Next page button: disabled when `pageNumber >= numPages`
  - Zoom out button: `scale > 0.5`, step -0.25
  - Zoom indicator: `{Math.round(scale * 100)}%`
  - Zoom in button: `scale < 3.0`, step +0.25
  - Download button: `<a href={resolvedUrl} download={name}>` — renders only when `resolvedUrl` is available

  Document/Page JSX:
  ```jsx
  <Document
    file={resolvedUrl}
    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
    onLoadError={(err) => setError(err.message)}
    options={{ isEvalSupported: false }}
  >
    <Page
      pageNumber={pageNumber}
      scale={scale}
      renderTextLayer={true}
      renderAnnotationLayer={true}
    />
  </Document>
  ```

- [ ] **Step 4: Run T7 to verify it passes**

  ```bash
  npx playwright test tests/pdf-components-application.spec.js --grep "PdfViewer: real component" --reporter=line
  ```

  Expected: PASS.

- [ ] **Step 5: Run T8 (PdfViewer malformed PDF error state)**

  ```bash
  npx playwright test tests/pdf-components-application.spec.js --grep "PdfViewer: malformed" --reporter=line
  ```

  Expected: PASS (error state "Failed to Load PDF" displayed).

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/PdfViewer.jsx tests/pdf-components-application.spec.js
  git commit -m "feat: replace @react-pdf-viewer with react-pdf in PdfViewer"
  ```

---

## Task 3: Update text-extraction worker registration (all three import components)

**Files:**
- Modify: `src/components/admin/BulkStudentImport.jsx` (line 10)
- Modify: `src/components/admin/BulkRegisteredStudentImport.jsx` (line 10)
- Modify: `src/components/admin/UploadResultsModal.jsx` (lines 6, 9)
- Modify: `tests/pdf-mitigation-browser.spec.js` (T1 source assertions)

**Interfaces:**
- Consumes: `pdfjs-dist` (v6.3.289 via shared node_modules), `pdfjs-dist/build/pdf.worker.min.mjs?url`
- Produces: All three components register the Vite-bundled worker; no static URL reference remains

- [ ] **Step 1: Update pdf-mitigation-browser.spec.js T1 source assertions**

  Test 1 reads source files and asserts `pdf.worker.min.js`. In v6, the source files will contain `pdf.worker.min.mjs`. Update:

  ```js
  expect(import1).toMatch(/pdf\.worker\.min\.mjs/);
  expect(import1).not.toContain('pdf.worker.min.js');
  // repeat for import2, import3, viewer
  ```

  Also update `test.beforeAll` to read from `pdfjs-dist/build/pdf.js` and `pdfjs-dist/build/pdf.worker.min.mjs` (the v6 path — `.mjs` not `.js`):
  ```js
  pdfWorkerCode = fs.readFileSync(path.join(pdfDistDir, 'pdf.worker.min.mjs'), 'utf8');
  ```

  Also update T2 worker loading to use `pdf.worker.min.mjs`:
  ```js
  const workerUrl = '/assets/pdf.worker.min.mjs';
  ```
  (Vite dev server serves the `?url` asset under `/assets/`.)

- [ ] **Step 2: Run T1 to confirm it currently fails (expecting .min.mjs, files still have .min.js)**

  ```bash
  npx playwright test tests/pdf-mitigation-browser.spec.js --grep "Source Code Verification" --reporter=line
  ```

  Expected: FAIL.

- [ ] **Step 3: Update BulkStudentImport.jsx**

  Replace lines 5–10:
  ```js
  import * as pdfjsLib from 'pdfjs-dist';
  import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
  ```

  All other code unchanged.

- [ ] **Step 4: Update BulkRegisteredStudentImport.jsx**

  Identical change to step 3 (same import pattern, lines 5–10).

- [ ] **Step 5: Update UploadResultsModal.jsx**

  Replace line 6 (`import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';`) and line 9 (static worker URL):
  ```js
  import * as pdfjsLib from 'pdfjs-dist';
  import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
  ```

  All other code (getDocument call, parsing logic, error handling, JSX) unchanged.

- [ ] **Step 6: Run T1 to confirm it now passes**

  ```bash
  npx playwright test tests/pdf-mitigation-browser.spec.js --grep "Source Code Verification" --reporter=line
  ```

  Expected: PASS.

- [ ] **Step 7: Run full pdf-mitigation-browser suite**

  ```bash
  npx playwright test tests/pdf-mitigation-browser.spec.js --reporter=line
  ```

  Expected: 8/8 PASS.

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/admin/BulkStudentImport.jsx src/components/admin/BulkRegisteredStudentImport.jsx src/components/admin/UploadResultsModal.jsx tests/pdf-mitigation-browser.spec.js
  git commit -m "feat: migrate text-extraction components to pdfjs-dist v6 worker"
  ```

---

## Task 4: Production build verification + static worker removal

**Files:**
- Delete: `public/pdf.worker.min.js`
- Verify: `dist/` build output

**Interfaces:**
- Consumes: All four migrated components
- Produces: Production build with `pdf.worker.min.mjs` in `dist/assets/`; `pdf.worker.min.js` absent from both `public/` and `dist/`

- [ ] **Step 1: Run production build**

  ```bash
  npm run build
  ```

  Expected: exits 0, no unresolved import errors, no `pdfjs-dist/legacy/build/pdf` errors.

- [ ] **Step 2: Verify worker asset in dist**

  ```bash
  ls dist/assets/ | Select-String "pdf.worker"
  ```

  Expected: one file matching `pdf.worker.min*.mjs` (with content-hash suffix). No `.min.js` variant.

- [ ] **Step 3: Verify no old worker in dist**

  ```bash
  ls dist/ | Select-String "pdf.worker.min.js"
  ```

  Expected: no match (the old static file must not appear in dist output).

- [ ] **Step 4: Delete the stale static worker**

  ```bash
  Remove-Item "public/pdf.worker.min.js"
  ```

- [ ] **Step 5: Run production build again (confirm no references to deleted file)**

  ```bash
  npm run build
  ```

  Expected: exits 0. No build warnings about missing `pdf.worker.min.js`.

- [ ] **Step 6: Run ESLint**

  ```bash
  npm run lint
  ```

  Expected: exits 0, zero errors.

- [ ] **Step 7: Commit**

  ```bash
  git add -A
  git commit -m "chore: remove stale public/pdf.worker.min.js, verify v6 worker bundles correctly"
  ```

---

## Task 5: Full browser test regression + final audit

**Files:**
- Verify: all existing Playwright suites
- Produce: `docs/superpowers/plans/audit-after.json`

**Interfaces:**
- Consumes: migrated codebase, running dev server
- Produces: passing suites, audit comparison

- [ ] **Step 1: Run pdf-components-application.spec.js (full suite)**

  ```bash
  npx playwright test tests/pdf-components-application.spec.js --reporter=line
  ```

  Expected: 10/10 PASS. Specifically verify:
  - T1 (BulkStudentImport valid PDF + isEvalSupported:false)
  - T2 (BulkStudentImport malformed → scoped errorMsg banner, import button disabled)
  - T3 (BulkRegisteredStudentImport valid)
  - T4 (BulkRegisteredStudentImport zero-byte → scoped error)
  - T5 (UploadResultsModal valid exam results PDF)
  - T6 (UploadResultsModal corrupted PDF → error alert without crash)
  - T7 (PdfViewer `.react-pdf__Document` visible, isEvalSupported:false in worker)
  - T8 (PdfViewer malformed → "Failed to Load PDF")
  - T9 (Full live navigation — student manager page)
  - T10 (Worker: no fake worker fallback, no "Setting up fake worker" console warning)

- [ ] **Step 2: Run pdf-mitigation-browser.spec.js (full suite)**

  ```bash
  npx playwright test tests/pdf-mitigation-browser.spec.js --reporter=line
  ```

  Expected: 8/8 PASS.

- [ ] **Step 3: Run super-admin suite (regression)**

  ```bash
  npx playwright test tests/super-admin.spec.js --reporter=line
  ```

  Expected: 88/88 PASS (no regressions from PDF changes).

- [ ] **Step 4: Run post-migration audit**

  ```bash
  npm audit --json > docs/superpowers/plans/audit-after.json
  npm audit
  ```

  Capture the text output for the report. Verify that:
  - `@react-pdf-viewer/core` and `@react-pdf-viewer/default-layout` are absent from the audit output
  - `pdfjs-dist` advisories reflect only the known medium DoS (AcroForm, patched in 6.4.299) — not the old high CVE-2024-4367 or CVE-2026-16633

- [ ] **Step 5: Verify `public/pdf.worker.min.js` is absent from git**

  ```bash
  git status
  git ls-files public/pdf.worker.min.js
  ```

  Expected: empty output (file not tracked).

- [ ] **Step 6: Verify no @react-pdf-viewer CSS imports remain in any source file**

  ```powershell
  Select-String -Path "src\**\*.jsx","src\**\*.js","src\**\*.ts","src\**\*.tsx" -Pattern "@react-pdf-viewer" -Recurse
  ```

  Expected: no matches.

- [ ] **Step 7: Final commit**

  ```bash
  git add docs/superpowers/plans/audit-after.json docs/superpowers/plans/audit-before.json
  git commit -m "chore: save pre/post migration npm audit snapshots"
  ```

- [ ] **Step 8: Tag the migration commit**

  ```bash
  git log --oneline -5
  # note the HEAD SHA for the implementation report
  ```

---

## Task 6: Implementation Report

**Files:**
- Create: artifact `pdf-engine-modernization-report.md` in brain/artifacts directory

**Interfaces:**
- Consumes: all task outputs, git log, npm audit results

- [ ] **Step 1: Write the implementation report artifact**

  Include:
  - Selected versions and rationale (react-pdf@11.0.0, pdfjs-dist@6.3.289)
  - DoS advisory disclosure and mitigations
  - Exact git commits (before/after)
  - Files changed with summary of each change
  - Before/after npm audit findings (exact counts, removed vulnerabilities, remaining)
  - Behavioral changes (documented toolbar feature removals)
  - All test results with counts
  - Worker bundling verification (asset hash filename, no static file)
  - Limitations: Linux ARM64 staging still required; DoS advisory pending upstream fix
  - Updated production approval checklist note (Option B completed)

- [ ] **Step 2: Update production-release-approval-checklist.md**

  Mark Option B PDF modernization as "Implemented — pending remote staging verification".
  Update candidate commit to the new HEAD SHA.
  Remove the temporary legacy-PDF acceptance path.
