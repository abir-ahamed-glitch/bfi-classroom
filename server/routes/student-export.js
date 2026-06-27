import express from 'express';
import db from '../db/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, PageOrientation } from 'docx';
import PDFDocument from 'pdfkit';

const router = express.Router();
const adminAuth = [authenticateToken, requireRole(['admin'])];

function getStudentsForExport(db, filters = {}) {
  let query = `
    SELECT 
      sp.student_id        AS "Student ID",
      u.first_name || ' ' || u.last_name AS "Full Name",
      u.email              AS "Email",
      u.mobile_number      AS "Mobile",
      sp.whatsapp_number   AS "WhatsApp",
      sp.batch_number      AS "Batch",
      DATE(u.created_at)   AS "Joined Date"
    FROM users u
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    WHERE u.role = 'student'
  `;

  const params = [];

  if (filters.student_ids && filters.student_ids.length > 0) {
    query += ` AND u.id IN (${filters.student_ids.map(() => '?').join(',')})`;
    params.push(...filters.student_ids);
  }

  if (filters.batch) {
    query += ` AND sp.batch_number = ?`;
    params.push(filters.batch);
  }

  if (filters.course) {
    query += ` AND EXISTS (
      SELECT 1 FROM student_course_enrollments sce 
      WHERE sce.user_id = u.id 
      AND sce.course_name = ?
    )`;
    params.push(filters.course);
  }

  if (filters.search) {
    query += ` AND (
      u.first_name LIKE ? OR 
      u.last_name LIKE ? OR 
      sp.student_id LIKE ? OR 
      u.email LIKE ? OR
      u.mobile_number LIKE ?
    )`;
    const s = `%${filters.search}%`;
    params.push(s, s, s, s, s);
  }

  query += ` ORDER BY u.created_at DESC`;

  return db.prepare(query).all(...params);
}

function parseFilters(query) {
  return {
    scope:       query.scope || 'all',
    student_ids: query.ids
      ? query.ids.split(',').map(Number).filter(Boolean)
      : [],
    search:  query.search  || null,
    batch:   query.batch   || null,
    course:  query.course  || null,
  };
}

function formatDateForFilename() {
  return new Date().toISOString().split('T')[0];
}

router.get('/excel', adminAuth, async (req, res) => {
  try {
    const students = getStudentsForExport(db, parseFilters(req.query));

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
      { header: 'Mobile',      key: 'Mobile',        width: 18 },
      { header: 'WhatsApp',    key: 'WhatsApp',      width: 18 },
      { header: 'Batch',       key: 'Batch',         width: 12 },
      { header: 'Joined Date', key: 'Joined Date',   width: 16 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FF1E3A5F' }
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF2563EB' } }
      };
    });
    headerRow.height = 28;

    students.forEach((student, index) => {
      const row = sheet.addRow(student);
      row.height = 22;
      if (index % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: 'FFF0F4FF' }
          };
        });
      }
      row.eachCell(cell => {
        cell.alignment = { vertical: 'middle' };
        cell.border = {
          bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } }
        };
      });
    });

    sheet.addRow([]);
    const summaryRow = sheet.addRow([
      `Total Students: ${students.length}`,
      '', '', '', '', '',
      `Exported: ${new Date().toLocaleDateString('en-GB')}`
    ]);
    summaryRow.font = { italic: true, color: { argb: 'FF6B7280' }, size: 10 };

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 7 }
    };

    const filename = `BFI_Students_${formatDateForFilename()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Excel Export Error:', error);
    res.status(500).json({ error: 'Failed to generate Excel export' });
  }
});

router.get('/word', adminAuth, async (req, res) => {
  try {
    const students = getStudentsForExport(db, parseFilters(req.query));

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 900, right: 900 },
            size: { orientation: PageOrientation.LANDSCAPE }
          }
        },
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: 'Bangladesh Film Institute',
                bold: true, size: 32,
                color: '1E3A5F'
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 }
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: 'BFI Classroom — Student Export Report',
                size: 22, color: '6B7280'
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 }
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: `Generated: ${new Date().toLocaleDateString('en-GB', {
                  weekday: 'long', year: 'numeric',
                  month: 'long', day: 'numeric'
                })}   |   Total Students: ${students.length}`,
                size: 18, color: '9CA3AF', italics: true
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  'Student ID', 'Full Name', 'Email',
                  'Mobile', 'WhatsApp', 'Batch', 'Joined Date'
                ].map(header => new TableCell({
                  children: [new Paragraph({
                    children: [new TextRun({
                      text: header, bold: true,
                      color: 'FFFFFF', size: 18
                    })],
                    alignment: AlignmentType.CENTER
                  })],
                  shading: { fill: '1E3A5F' },
                  margins: { top: 80, bottom: 80, left: 120, right: 120 }
                }))
              }),

              ...students.map((student, index) =>
                new TableRow({
                  children: [
                    student['Student ID'],
                    student['Full Name'],
                    student['Email'],
                    student['Mobile'] || '—',
                    student['WhatsApp'] || '—',
                    student['Batch'] ? `${student['Batch']}th Batch` : '—',
                    student['Joined Date'] || '—'
                  ].map(value => new TableCell({
                    children: [new Paragraph({
                      children: [new TextRun({ text: String(value), size: 16 })],
                    })],
                    shading: {
                      fill: index % 2 === 0 ? 'F0F4FF' : 'FFFFFF'
                    },
                    margins: { top: 60, bottom: 60, left: 120, right: 120 }
                  }))
                })
              )
            ]
          }),

          new Paragraph({
            children: [
              new TextRun({
                text: `\nThis document was generated automatically by BFI Classroom Admin Panel.`,
                size: 16, italics: true, color: '9CA3AF'
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 400 }
          })
        ]
      }]
    });

    const filename = `BFI_Students_${formatDateForFilename()}.docx`;
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Word Export Error:', error);
    res.status(500).json({ error: 'Failed to generate Word export' });
  }
});

router.get('/pdf', adminAuth, (req, res) => {
  try {
    const students = getStudentsForExport(db, parseFilters(req.query));

    const doc = new PDFDocument({
      margin: 40,
      size: 'A4',
      layout: 'landscape'
    });

    const filename = `BFI_Students_${formatDateForFilename()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    const DARK_BLUE  = '#1E3A5F';
    const MID_BLUE   = '#2563EB';
    const LIGHT_BLUE = '#EFF6FF';
    const GREY       = '#6B7280';
    const WHITE      = '#FFFFFF';

    doc.rect(0, 0, doc.page.width, 70).fill(DARK_BLUE);
    doc.fillColor(WHITE)
       .font('Helvetica-Bold').fontSize(20)
       .text('Bangladesh Film Institute', 40, 18, { align: 'center' });
    doc.fillColor('#93C5FD')
       .font('Helvetica').fontSize(11)
       .text('BFI Classroom — Student Export Report', 40, 44, { align: 'center' });

    doc.rect(0, 70, doc.page.width, 28).fill(MID_BLUE);
    doc.fillColor(WHITE).font('Helvetica').fontSize(9);
    doc.text(
      `Generated: ${new Date().toLocaleDateString('en-GB', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      })}`,
      40, 79
    );
    doc.text(`Total Students: ${students.length}`, 0, 79, {
      align: 'right', width: doc.page.width - 40
    });

    const tableTop    = 115;
    const rowHeight   = 22;
    const pageWidth   = doc.page.width - 80;
    const colWidths   = [90, 120, 160, 90, 90, 60, 80];
    const colHeaders  = [
      'Student ID', 'Full Name', 'Email',
      'Mobile', 'WhatsApp', 'Batch', 'Joined'
    ];

    doc.rect(40, tableTop, pageWidth, rowHeight).fill(DARK_BLUE);
    let xPos = 40;
    colHeaders.forEach((header, i) => {
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8)
         .text(header, xPos + 4, tableTop + 7, {
           width: colWidths[i] - 8, align: 'left'
         });
      xPos += colWidths[i];
    });

    let yPos = tableTop + rowHeight;

    students.forEach((student, rowIndex) => {
      if (yPos + rowHeight > doc.page.height - 60) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });

        doc.rect(40, 40, pageWidth, rowHeight).fill(DARK_BLUE);
        let hx = 40;
        colHeaders.forEach((header, i) => {
          doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8)
             .text(header, hx + 4, 47, { width: colWidths[i] - 8 });
          hx += colWidths[i];
        });
        yPos = 40 + rowHeight;
      }

      if (rowIndex % 2 === 0) {
        doc.rect(40, yPos, pageWidth, rowHeight).fill(LIGHT_BLUE);
      }

      const rowData = [
        student['Student ID'] || '—',
        student['Full Name']  || '—',
        student['Email']      || '—',
        student['Mobile']     || '—',
        student['WhatsApp']   || '—',
        student['Batch'] ? `${student['Batch']}th` : '—',
        student['Joined Date'] || '—'
      ];

      let rx = 40;
      rowData.forEach((value, i) => {
        doc.fillColor('#111827').font('Helvetica').fontSize(7.5)
           .text(String(value), rx + 4, yPos + 7, {
             width: colWidths[i] - 8,
             align: 'left',
             lineBreak: false
           });
        rx += colWidths[i];
      });

      doc.moveTo(40, yPos + rowHeight)
         .lineTo(40 + pageWidth, yPos + rowHeight)
         .strokeColor('#E5E7EB').lineWidth(0.5).stroke();

      yPos += rowHeight;
    });

    doc.fillColor(GREY).font('Helvetica-Oblique').fontSize(8)
       .text(
         'Generated automatically by BFI Classroom Admin Panel — Bangladesh Film Institute',
         40, doc.page.height - 35,
         { align: 'center', width: pageWidth }
       );

    doc.end();
  } catch (error) {
    console.error('PDF Export Error:', error);
    res.status(500).json({ error: 'Failed to generate PDF export' });
  }
});

export default router;
