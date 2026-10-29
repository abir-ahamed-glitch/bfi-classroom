/**
 * Generates valid and malformed PDF fixtures for application component tests
 * using standard PDFKit to guarantee specification-compliant PDF binaries.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const FIXTURES_DIR = path.resolve(__dirname, '../tests/fixtures/pdf');
const PUBLIC_FIXTURES_DIR = path.resolve(__dirname, '../public/test-fixtures');

[FIXTURES_DIR, PUBLIC_FIXTURES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function createPdfBuffer(generatorFn) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ autoFirstPage: true, margin: 40 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    generatorFn(doc);
    doc.end();
  });
}

async function generateAll() {
  // 1. Valid bulk students PDF with columns
  const studentsPdf = await createPdfBuffer((doc) => {
    doc.fontSize(14).text('10th Batch Filmmaking Course - Student Roster', 50, 40);
    doc.fontSize(10);
    const headers = [
      { text: 'SL', x: 50 },
      { text: 'Student Name', x: 80 },
      { text: 'Email', x: 200 },
      { text: 'Mobile', x: 360 },
      { text: 'Batch', x: 480 }
    ];
    const rows = [
      ['1', 'Abir Ahmad', 'k.eye.films@gmail.com', '01711223344', '10'],
      ['2', 'Sadia Islam', 'sadia@example.com', '01811223344', '10'],
      ['3', 'Tanvir Hossain', 'tanvir@example.com', '01911223344', '10']
    ];
    const yStart = 80;
    headers.forEach(h => doc.text(h.text, h.x, yStart));
    rows.forEach((row, idx) => {
      const y = yStart + 25 * (idx + 1);
      row.forEach((val, cIdx) => {
        doc.text(val, headers[cIdx].x, y);
      });
    });
  });

  // 2. Valid exam results PDF with columns
  const resultsPdf = await createPdfBuffer((doc) => {
    doc.fontSize(14).text('Examination Results - Directing Assessment', 50, 40);
    doc.fontSize(10);
    const headers = [
      { text: 'Roll', x: 50 },
      { text: 'Name', x: 100 },
      { text: 'Marks', x: 280 },
      { text: 'Remarks', x: 380 }
    ];
    const rows = [
      ['1', 'Abir Ahmad', '88', 'Pass'],
      ['2', 'Sadia Islam', '94', 'Pass'],
      ['3', 'Tanvir Hossain', '76', 'Pass']
    ];
    const yStart = 80;
    headers.forEach(h => doc.text(h.text, h.x, yStart));
    rows.forEach((row, idx) => {
      const y = yStart + 25 * (idx + 1);
      row.forEach((val, cIdx) => {
        doc.text(val, headers[cIdx].x, y);
      });
    });
  });

  // 3. Valid sample PDF for viewer
  const viewerPdf = await createPdfBuffer((doc) => {
    doc.fontSize(16).text('Bangladesh Film Institute', { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(12).text('Official Course Materials and Student Guide');
    doc.text('This document verifies secure PDF rendering with isEvalSupported: false.');
  });

  // 4. Corrupted PDF (invalid structure)
  const corruptPdf = Buffer.from('%PDF-1.4\nCORRUPT_BYTES_NOT_A_VALID_OBJECT_STREAM\n%%EOF');

  // 5. Zero byte PDF
  const zeroBytePdf = Buffer.alloc(0);

  // Write to both fixture locations
  [FIXTURES_DIR, PUBLIC_FIXTURES_DIR].forEach(dir => {
    fs.writeFileSync(path.join(dir, 'valid-students.pdf'), studentsPdf);
    fs.writeFileSync(path.join(dir, 'valid-results.pdf'), resultsPdf);
    fs.writeFileSync(path.join(dir, 'valid-sample.pdf'), viewerPdf);
    fs.writeFileSync(path.join(dir, 'corrupted-header.pdf'), corruptPdf);
    fs.writeFileSync(path.join(dir, 'zero-byte.pdf'), zeroBytePdf);
  });

  console.log('Successfully generated 5 PDF fixtures with PDFKit in both directories.');
}

generateAll().catch(console.error);
