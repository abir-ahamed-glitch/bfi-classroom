# PDF Engine Modernization — Design Spec
**Date:** 2026-10-30  
**Branch:** `integration/super-admin-candidate`  
**Pre-migration commit:** `d25534d8e4755827a3efc87ed8b832ac2817effb`  
**Status:** Draft — pending implementation

---

## 1. Problem Statement

The current PDF stack has three critical issues:

1. **`@react-pdf-viewer/core@3.12.0` is archived** (March 2026). It depends on `pdfjs-dist@3.11.174` and was never updated for pdfjs-dist v4+ or React 19. No security fixes will come.
2. **`pdfjs-dist@3.11.174` has CVE-2024-4367** (CVSS 8.8–9.8): arbitrary JS execution via font type confusion. Mitigated in this project by `isEvalSupported: false`, but the underlying code is unpatched and the mitigation must be actively preserved.
3. **Static `public/pdf.worker.min.js`** is manually copied and can become stale relative to the installed pdfjs-dist version, causing silent version-mismatch failures.

The `UploadResultsModal` additionally uses `pdfjs-dist/legacy/build/pdf` — a path that does not exist in pdfjs-dist v4+, which would break on upgrade.

---

## 2. Selected Dependency Combination

### 2a. Version Selection Rationale

| Package | Selected Version | pdfjs-dist pinned | Known Advisories |
|---------|-----------------|-------------------|-----------------|
| `react-pdf` | `11.0.0` | `6.3.289` (exact) | Medium DoS (AcroForm CPU loop) in `<6.4.299` — mitigated below |
| `pdfjs-dist` | `6.3.289` (transitively from react-pdf) | — | Same DoS; below CVE-2026-16633 threshold (`>=5.6.83,<6.2.108`) |

**Why `react-pdf@11.0.0`:**
- Only version explicitly requiring `react@^19.0.0` (matches project `^19.2.4`)
- Actively maintained; not archived
- Uses pdfjs-dist v6 which resolves all prior `isEvalSupported`-class and `enableScripting`-class advisories

**DoS advisory disclosure (medium severity):**  
`pdfjs-dist@6.3.289` has a known medium-severity advisory (AcroForm unbounded font-size loop → CPU exhaustion via crafted PDF). Patched in `6.4.299`. This project cannot independently force `react-pdf@11.0.0` to use `6.4.299` without overrides (react-pdf pins `6.3.289` exactly). Mitigation: this application does not enable AcroForm scripting (`enableScripting` defaults to `false` in v6; `isEvalSupported: false` is preserved); all uploaded PDFs come from authenticated admin users over HTTPS on a private application. No override or `--legacy-peer-deps` will be used. The remaining exposure is documented here and in the implementation report. A follow-up upgrade to a future `react-pdf` version pinning `>=6.4.299` is recommended when published.

**Why one shared pdfjs engine:**  
All four consumers (PdfViewer, BulkStudentImport, BulkRegisteredStudentImport, UploadResultsModal) will use the `pdfjs-dist@6.3.289` instance that `react-pdf@11.0.0` installs as its own dependency. The three text-extraction components will import `pdfjs-dist` directly — npm will resolve to the single shared installation because `react-pdf` pins it exactly, not as a range. Verified post-install.

### 2b. Worker File

pdfjs-dist v6 ships ESM workers: `build/pdf.worker.min.mjs` (not `.min.js`). The correct Vite bundled import is:

```js
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
```

This imports the worker as a URL asset — Vite copies it into `dist/assets/` and the URL is version-locked to whatever pdfjs-dist version is installed. No manual copy required. The static `public/pdf.worker.min.js` (v3, `.js` extension) is removed after all consumers migrate.

---

## 3. Architecture: Component-by-Component Changes

### 3a. PdfViewer.jsx (visual viewer)

**Current:** `@react-pdf-viewer/core` `Worker` + `Viewer` + `defaultLayoutPlugin`; CSS from two `@react-pdf-viewer` packages; static worker URL from `BASE_URL`.

**New:** `react-pdf` `Document` + `Page` components; CSS from `react-pdf/dist/Page/AnnotationLayer.css` + `react-pdf/dist/Page/TextLayer.css`; worker set via `pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl` (Vite `?url` import).

**Preserved behavior:**
- Base64 API endpoint fetch: `url.includes('/base64')` → fetch → decode → `URL.createObjectURL` → revoke on cleanup — **unchanged**
- Direct URL path — **unchanged**
- `isMounted` guard preventing state updates after unmount — **unchanged**
- Error state ("Failed to Load PDF") — **unchanged**
- Loading state ("Decoding PDF secure payload...") — **unchanged**
- `isEvalSupported: false` — passed via `Document options={{ isEvalSupported: false }}`
- `containerStyle` prop — **unchanged**
- `onClick={e => e.stopPropagation()}` — **unchanged**

**Toolbar/controls — behavior change (documented):**  
The existing `defaultLayoutPlugin` from `@react-pdf-viewer` provided a full toolbar: thumbnails sidebar, zoom controls, page navigation, download button, print button, full-screen button, search within PDF, rotation. `react-pdf` provides `Document` + `Page` primitives only — the consuming code must implement UI controls.

This implementation will add a minimal toolbar row above the page canvas providing: page counter (current/total), previous/next page buttons, zoom in/out buttons (with step and min/max bounds), and a download button (using `url` prop when it's a direct URL, or the blob URL for base64 sources). Text selection is enabled by including `TextLayer`. Annotations are enabled by including `AnnotationLayer`. Thumbnails sidebar, print, full-screen, and in-PDF search are **not** replicated — these were provided by `defaultLayoutPlugin` extras and are not part of the documented core functionality in existing tests or user documentation.

**Intentional behavior changes from defaultLayoutPlugin removal:**
- No thumbnail sidebar panel
- No in-PDF text search (Ctrl+F inside viewer)
- No print button (browser print still works via Ctrl+P)
- No full-screen toggle
- Zoom presets replaced by +/- buttons (no dropdown with "Fit width", "Fit page" etc.)

These are the only behavioral changes. All four are documented here before implementation.

### 3b. BulkStudentImport.jsx (text extraction)

**Current:**
```js
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL || '/bfi-classroom/'}pdf.worker.min.js`;
```

**New:**
```js
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
```

`getDocument({ data: new Uint8Array(...), isEvalSupported: false })` API — **unchanged**.  
All text extraction logic (Y-coordinate row grouping, sorting) — **unchanged**.  
Error handling (`setErrorMsg`) — **unchanged**.

### 3c. BulkRegisteredStudentImport.jsx (text extraction)

Identical change to BulkStudentImport above. The legacy import path `pdfjs-dist/legacy/build/pdf` is NOT used here (it uses standard `pdfjs-dist`). The only change is the worker registration.

### 3d. UploadResultsModal.jsx (text extraction, legacy import path)

**Current:**
```js
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL || '/bfi-classroom/'}pdf.worker.min.js`;
```

`pdfjs-dist/legacy/build/pdf` does not exist in pdfjs-dist v6. **New:**
```js
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
```

`getDocument({ data: new Uint8Array(...), isEvalSupported: false })` API — **unchanged**.  
All result-parsing logic — **unchanged**.

---

## 4. Worker Bundling Design

### Vite `?url` import mechanism

Vite's `?url` query converts a module import into a URL string pointing to the emitted asset. The bundler:
1. Copies `pdfjs-dist/build/pdf.worker.min.mjs` into `dist/assets/` with a content-hash filename (e.g., `pdf.worker.min-Bx2kR9Pq.mjs`)
2. Returns the URL as a string (`/bfi-classroom/assets/pdf.worker.min-Bx2kR9Pq.mjs`)
3. Browsers load it as a same-origin Web Worker script — matching existing CSP `worker-src 'self' blob:`

This satisfies all requirements:
- **Automated:** No manual copy needed; the worker is always the version in `node_modules`
- **Same-origin:** Served from `/bfi-classroom/assets/` — no CDN, no external origin
- **CSP-safe:** `worker-src 'self' blob:` covers `'self'`-origin scripts
- **Version-locked:** The content hash changes when pdfjs-dist is upgraded — stale workers are impossible

### Worker registration

`PdfViewer.jsx` sets `pdfjs.GlobalWorkerOptions.workerSrc` via `react-pdf`'s exported `pdfjs` object.  
The three text-extraction components set it via `pdfjsLib.GlobalWorkerOptions.workerSrc`.  
All four set it to the same `pdfjsWorkerUrl` string — the same asset URL. Worker deduplication by URL is handled by the browser.

### Removal of `public/pdf.worker.min.js`

The static v3 worker file is deleted after all four consumers are confirmed migrated and the production build is verified. It is NOT deleted before migration.

---

## 5. Removed Packages

After migration and verification:
- `@react-pdf-viewer/core` — removed from `package.json`
- `@react-pdf-viewer/default-layout` — removed from `package.json`
- CSS imports in `PdfViewer.jsx` from both packages — removed

pdfjs-dist remains in `package.json` for the three text-extraction components. `react-pdf` is added as a new direct dependency.

---

## 6. CSP Verification

Current CSP in `server/server.js`:
- `worker-src 'self' blob:` — covers the new worker URL (same-origin asset)
- No `unsafe-eval` — preserved; `isEvalSupported: false` enforced
- No external CDN origins — preserved; worker is self-hosted

No CSP changes required.

---

## 7. Test Strategy

### Existing suites that must pass (no regression)
- `pdf-mitigation-browser.spec.js` (8 tests) — updated to reference v6 worker path
- `pdf-components-application.spec.js` (10 tests) — updated T7 selector (`.rpv-core__viewer` → new viewer class), T1 source-code assertions updated for new import patterns

### New/updated assertions
- Valid single-page PDF: renders page, text selection active
- Multi-page PDF: pagination controls work, page count correct
- Malformed PDF: error boundary shows without crash
- Zero-byte PDF: error boundary shows without crash
- Worker: dedicated Web Worker created (not fake worker fallback)
- `isEvalSupported: false` reaches worker `evaluatorOptions`
- Production build: `pdf.worker.min.mjs` present in `dist/assets/`, no `pdf.worker.min.js` present
- `public/pdf.worker.min.js` absent after migration

### Negative controls
- Malformed PDF must show scoped errorMsg banner (not just filename text)
- Import button disabled when errorMsg is set (previewData empty)

---

## 8. Node / Browser Compatibility

- **Node.js:** pdfjs-dist v6 requires Node ≥18. Production server runs Node 20 (Ubuntu 22.04 ARM64). ✓
- **Browser:** pdfjs-dist v6 uses ES2022 features (top-level await in worker). Targets: Chrome 98+, Firefox 99+, Safari 15.4+. Mobile: Chrome/Android 98+, Safari iOS 15.4+. This matches the application's existing target (Vite default modern targets). No IE11 or old-Safari support has ever been claimed. ✓
- **CSP:** `worker-src 'self' blob:` — unchanged. ✓

---

## 9. Files Changed

| File | Change |
|------|--------|
| `package.json` | Add `react-pdf@11.0.0`; remove `@react-pdf-viewer/core`, `@react-pdf-viewer/default-layout` |
| `src/components/PdfViewer.jsx` | Replace viewer implementation (see §3a) |
| `src/components/admin/BulkStudentImport.jsx` | Update worker registration (see §3b) |
| `src/components/admin/BulkRegisteredStudentImport.jsx` | Update worker registration (see §3c) |
| `src/components/admin/UploadResultsModal.jsx` | Fix legacy import + worker registration (see §3d) |
| `public/pdf.worker.min.js` | Delete after verification |
| `tests/pdf-mitigation-browser.spec.js` | Update worker path assertions for v6 `.mjs` |
| `tests/pdf-components-application.spec.js` | Update T7 selector, T1 source assertions |
| `src/test-pdf-mount.jsx` (if exists) | Update worker setup if present |

---

## 10. Rollback

If the migration fails verification:
- `git checkout HEAD -- src/components/PdfViewer.jsx src/components/admin/BulkStudentImport.jsx src/components/admin/BulkRegisteredStudentImport.jsx src/components/admin/UploadResultsModal.jsx`
- `npm uninstall react-pdf; npm install @react-pdf-viewer/core@3.12.0 @react-pdf-viewer/default-layout@3.12.0 pdfjs-dist@3.11.174`
- Restore `public/pdf.worker.min.js` from git (`git checkout HEAD -- public/pdf.worker.min.js`)
- The legacy stack is still at `d25534d8` — pre-migration commit is the rollback target
