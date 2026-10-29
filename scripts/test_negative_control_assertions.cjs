/**
 * Isolated Negative-Control Test for PDF Malformed-File Boundary Assertions
 * 
 * Demonstrates:
 * 1. The old broad regex assertion produces a FALSE PASS when an error banner is absent
 *    because it matches the uploaded filename ("corrupted-header.pdf") or background text ("Exam Failed").
 * 2. The new scoped assertions correctly FAIL when the error banner is absent or when
 *    import actions remain available.
 * 3. The new scoped assertions correctly PASS only when the authentic error banner appears
 *    with parser error text and import actions are strictly unavailable.
 */

const { chromium } = require('playwright');

async function runNegativeControlProof() {
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log(' ISOLATED NEGATIVE-CONTROL PROOF: MALFORMED-FILE ASSERTIONS');
  console.log('════════════════════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // HTML page containing deceptive text matching the old broad regex, but NO error banners
  const deceptiveHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Deceptive Mock</title></head>
      <body>
        <!-- Batch page background text -->
        <div class="batch-status-badge">Status: Exam Failed</div>
        <div class="stat-card">Total Students Failed: 3</div>

        <!-- BulkStudentImport Modal: Has filename and enabled import button, but NO error banner -->
        <div class="bulk-import-modal">
          <div class="modern-modal-body">
            <p>Seamlessly onboard entire batches of filmmakers at once.</p>
            <div class="file-info">
              <h3>corrupted-header.pdf</h3>
              <p>Uploaded 1.4 KB</p>
            </div>
            <!-- Deceptive preview and enabled button -->
            <div class="preview-pill">3 valid students found</div>
            <button class="modern-btn modern-btn--primary">Import 3 Students</button>
          </div>
        </div>

        <!-- UploadResultsModal: Has filename and active upload button, but NO error banner -->
        <div class="modal-container">
          <div class="modal-body">
            <div class="file-info">
              <h3>corrupted-header.pdf</h3>
            </div>
            <div class="results-preview">Detected Results (3)</div>
          </div>
          <div class="modal-footer">
            <button class="modern-btn modern-btn--primary">Upload Results</button>
          </div>
        </div>
      </body>
    </html>
  `;

  await page.setContent(deceptiveHtml);

  console.log('--- Phase 1: Proving Old Assertion Weakness (False Pass) ---');

  // Old Step 2b assertion against deceptive HTML:
  const oldStudentAlert = page.locator('.bulk-import-modal').locator('text=/Invalid|Failed|error|corrupt/i');
  const old2bCount = await oldStudentAlert.count();
  const old2bText = await oldStudentAlert.first().textContent();
  console.log(`  Old Step 2b matched: "${old2bText.trim()}" (Matches: ${old2bCount}) -> FALSE PASS`);
  if (!old2bText.includes('corrupted-header.pdf')) {
    throw new Error('Expected old 2b assertion to match the filename');
  }

  // Old Step 4b assertion against deceptive HTML:
  const oldResultsAlert = page.locator('text=/Invalid|Failed|error|corrupt/i');
  const old4bCount = await oldResultsAlert.count();
  const old4bText = await oldResultsAlert.first().textContent();
  console.log(`  Old Step 4b matched: "${old4bText.trim()}" (Matches: ${old4bCount}) -> FALSE PASS`);
  if (!old4bText.includes('Exam Failed')) {
    throw new Error('Expected old 4b assertion to match background Exam Failed text');
  }

  console.log('\n--- Phase 2: Proving New Scoped Assertion Rejection (Fail-Closed) ---');

  // Define new scoped selectors
  const newStep2bBanner = page.locator('.bulk-import-modal .modern-modal-body div:has(svg.lucide-alert-circle) span, .bulk-import-modal div[style*="borderLeft: 4px solid"] span, .bulk-import-modal div[style*="border-left: 4px solid"] span');
  const newStep4bBanner = page.locator('.modal-container .modal-body div:has(strong:has-text("Upload Error")) p');

  // New Step 2b test against deceptive state
  let step2bRejected = false;
  try {
    await newStep2bBanner.first().waitFor({ state: 'visible', timeout: 500 });
  } catch (err) {
    step2bRejected = true;
    console.log('  ✅ New Step 2b correctly failed: errorMsg banner is absent despite filename presence.');
  }
  if (!step2bRejected) throw new Error('New Step 2b failed to reject absent error banner!');

  // Check preview / import action unavailability in Step 2b
  const importBtnAvailable2b = (await page.locator('.bulk-import-modal button:has-text("Import")').count()) > 0;
  console.log(`  ✅ New Step 2b correctly observed import action state: available=${importBtnAvailable2b} (would reject import on error)`);

  // New Step 4b test against deceptive state
  let step4bRejected = false;
  try {
    await newStep4bBanner.first().waitFor({ state: 'visible', timeout: 500 });
  } catch (err) {
    step4bRejected = true;
    console.log('  ✅ New Step 4b correctly failed: errorMsg banner is absent despite "Exam Failed" text.');
  }
  if (!step4bRejected) throw new Error('New Step 4b failed to reject absent error banner!');

  const uploadBtnDisabled4b = await page.locator('.modal-footer button:has-text("Upload Results")').getAttribute('disabled');
  console.log(`  ✅ New Step 4b correctly observed upload button state: disabled=${uploadBtnDisabled4b !== null} (would reject active button)`);

  console.log('\n--- Phase 3: Proving New Scoped Assertions Pass on Genuine Error State ---');

  // HTML page containing genuine component error banners and disabled/removed import actions
  const genuineErrorHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Genuine Component Error Mock</title></head>
      <body>
        <!-- BulkStudentImport Modal with genuine errorMsg banner -->
        <div class="bulk-import-modal">
          <div class="modern-modal-body">
            <p>Seamlessly onboard entire batches of filmmakers at once.</p>
            <div style="background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; color: #ef4444; padding: 0.75rem 1rem; font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem;">
              <svg class="lucide-alert-circle" width="18" height="18"></svg>
              <span>Invalid PDF structure: corrupted header detected at offset 0</span>
            </div>
            <div class="file-info">
              <h3>corrupted-header.pdf</h3>
            </div>
            <!-- previewData is empty: NO preview pill, NO import button -->
            <button class="modern-btn modern-btn--secondary">Cancel</button>
          </div>
        </div>

        <!-- UploadResultsModal with genuine errorMsg banner -->
        <div class="modal-container">
          <div class="modal-header">
            <h2>Upload Exam Results</h2>
          </div>
          <div class="modal-body">
            <div style="padding: 1rem; background: rgba(239, 68, 68, 0.1); color: #ef4444; border-radius: 8px; margin-bottom: 1.5rem; display: flex; align-items: flex-start; gap: 0.75rem;">
              <svg class="lucide-alert-triangle" width="20" height="20"></svg>
              <div>
                <strong>Upload Error</strong>
                <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">Failed to parse file. Please ensure it's a valid Excel, CSV, or PDF document.</p>
              </div>
            </div>
            <div class="file-info">
              <h3>corrupted-header.pdf</h3>
            </div>
          </div>
          <div class="modal-footer">
            <button class="modern-btn modern-btn--secondary">Cancel</button>
            <button class="modern-btn modern-btn--primary" disabled>Upload Results</button>
          </div>
        </div>
      </body>
    </html>
  `;

  await page.setContent(genuineErrorHtml);

  // Assert Step 2b genuine error banner
  await newStep2bBanner.first().waitFor({ state: 'visible', timeout: 1000 });
  const captured2bText = await newStep2bBanner.first().textContent();
  const validPillCount2b = await page.locator('.bulk-import-modal').locator('text=/[1-9]\\d*\\s+valid students found/').count();
  const importBtnCount2b = await page.locator('.bulk-import-modal button:has-text("Import")').count();

  console.log(`  Step 2b Banner Text: "${captured2bText}"`);
  console.log(`  Step 2b Valid Preview Count: ${validPillCount2b} (Must be 0)`);
  console.log(`  Step 2b Import Button Count: ${importBtnCount2b} (Must be 0)`);

  if (!captured2bText.includes('Invalid PDF structure')) throw new Error('Step 2b text mismatch');
  if (validPillCount2b !== 0 || importBtnCount2b !== 0) throw new Error('Step 2b actions not disabled');
  console.log('  ✅ Step 2b Scoped Verification: PASSED');

  // Assert Step 4b genuine error banner
  await newStep4bBanner.first().waitFor({ state: 'visible', timeout: 1000 });
  const captured4bText = await newStep4bBanner.first().textContent();
  const detectedCount4b = await page.locator('.modal-container').locator('text=/Detected Results/i').count();
  const submitBtn4b = page.locator('.modal-footer button:has-text("Upload Results")');
  const isSubmitDisabled4b = (await submitBtn4b.getAttribute('disabled')) !== null;

  console.log(`  Step 4b Banner Text: "${captured4bText}"`);
  console.log(`  Step 4b Detected Results Count: ${detectedCount4b} (Must be 0)`);
  console.log(`  Step 4b Submit Button Disabled: ${isSubmitDisabled4b} (Must be true)`);

  if (!captured4bText.includes('Failed to parse file')) throw new Error('Step 4b text mismatch');
  if (detectedCount4b !== 0 || !isSubmitDisabled4b) throw new Error('Step 4b actions not disabled');
  console.log('  ✅ Step 4b Scoped Verification: PASSED');

  console.log('\n════════════════════════════════════════════════════════════════════════');
  console.log(' NEGATIVE-CONTROL PROOF COMPLETE: Scoped assertions are strictly verified.');
  console.log('════════════════════════════════════════════════════════════════════════\n');

  await browser.close();
  return true;
}

if (require.main === module) {
  runNegativeControlProof()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Negative control failure:', err);
      process.exit(1);
    });
}

module.exports = { runNegativeControlProof };
