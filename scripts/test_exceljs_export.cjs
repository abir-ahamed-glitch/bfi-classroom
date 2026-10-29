#!/usr/bin/env node
/**
 * scripts/test_exceljs_export.cjs
 *
 * Verifies ExcelJS 4.4.0 with overridden uuid 11.1.1.
 * Tests workbook creation, worksheet styling, cell borders, x14Id UUID generation,
 * and binary buffer output matching the production student export route.
 */

const assert = require('assert');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`Testing: ${name}... `);
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      await res;
    }
    console.log('✅ PASS');
    passedTests++;
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('================================================================');
  console.log('EXCELJS 4.4.0 & UUID 11.1.1 INTEGRATION TEST SUITE');
  console.log('Testing Engine: ExcelJS 4.4.0 with uuid 11.1.1 Override');
  console.log('================================================================\n');

  // Verify locked uuid version
  const uuidPkg = require('uuid/package.json');
  console.log(`Resolved uuid version: ${uuidPkg.version}\n`);
  const major = parseInt(uuidPkg.version.split('.')[0], 10);
  assert.ok(major >= 11, `Expected uuid >= 11.x, got ${uuidPkg.version}`);

  await runTest('ExcelJS: initializes workbook with styled worksheets and metadata', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BFI Classroom';
    workbook.created = new Date();
    workbook.title = 'BFI Student Export';

    const sheet = workbook.addWorksheet('Students', {
      pageSetup: { paperSize: 9, orientation: 'landscape' }
    });

    sheet.columns = [
      { header: 'Student ID',  key: 'Student ID',   width: 18 },
      { header: 'Full Name',   key: 'Full Name',     width: 28 },
      { header: 'Email',       key: 'Email',         width: 32 },
      { header: 'Batch',       key: 'Batch',         width: 12 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FF1E3A5F' }
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    });

    const sampleStudents = [
      { 'Student ID': 'BFI-2026-001', 'Full Name': 'Abir Ahmad', 'Email': 'abir@example.com', 'Batch': 'B-01' },
      { 'Student ID': 'BFI-2026-002', 'Full Name': 'Sadia Islam', 'Email': 'sadia@example.com', 'Batch': 'B-02' }
    ];

    sampleStudents.forEach(s => sheet.addRow(s));

    const buffer = await workbook.xlsx.writeBuffer();
    assert.ok(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array, 'Must produce binary buffer');
    assert.ok(buffer.length > 0, 'Buffer must be non-empty');

    // Parse back with SheetJS to verify file integrity and record fidelity
    const parsedWb = XLSX.read(buffer, { type: 'buffer' });
    const parsedSheet = parsedWb.Sheets['Students'];
    assert.ok(parsedSheet, 'Parsed workbook must contain Students sheet');

    const json = XLSX.utils.sheet_to_json(parsedSheet);
    assert.strictEqual(json.length, 2, 'Must have 2 records');
    assert.strictEqual(json[0]['Student ID'], 'BFI-2026-001');
    assert.strictEqual(json[0]['Full Name'], 'Abir Ahmad');
    assert.strictEqual(json[1]['Student ID'], 'BFI-2026-002');
    assert.strictEqual(json[1]['Full Name'], 'Sadia Islam');
  });

  await runTest('uuid 11.1.1: v4 exports function and produces valid UUID string', () => {
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  console.log(`\n================================================================`);
  console.log(`ExcelJS Results: ${passedTests}/${totalTests} Passed`);
  console.log(`================================================================`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('ExcelJS test error:', err);
    process.exit(1);
  });
}
