/**
 * Isolated Spreadsheet Runner
 * 
 * Executes spreadsheet parsing in an isolated subprocess with strict execution bounds.
 */

const XLSX = require('xlsx');

async function main() {
  const { safeReadSpreadsheet } = await import('../src/utils/safeSpreadsheet.js');

  // Build a dense fixture with 100 rows and multiple data columns
  const rows = [['Index', 'Label', 'FormulaCell', 'Number']];
  for (let i = 0; i < 100; i++) {
    rows.push([i, `Item_${i}`, `=SUM(D1:D${i + 1})`, i * 2.5]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'DenseTest');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const startTime = Date.now();
  // Parse with strict row bound (maxRows: 101 to allow 1 header + 100 rows)
  const result = safeReadSpreadsheet(buf, { maxRows: 101 });
  const durationMs = Date.now() - startTime;

  if (!Array.isArray(result) || result.length !== 101) {
    console.error(`Expected 101 rows, got ${result ? result.length : 0}`);
    process.exit(1);
  }

  console.log(`ISOLATED_PARSE_SUCCESS: parsed ${result.length} rows in ${durationMs}ms`);
  process.exit(0);
}

main().catch(err => {
  console.error('Isolated runner error:', err);
  process.exit(1);
});
