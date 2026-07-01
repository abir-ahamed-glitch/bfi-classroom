const Database = require('better-sqlite3');
const db = new Database('server/bfi_classroom.db');

const paidFeeDetails = JSON.stringify({
  full_fee: '8000',
  amount_paid: '8000',
  status: 'Paid Full',
  discount: '',
  installments: []
});

const result = db.prepare(`
  UPDATE student_course_enrollments
  SET fee_details = ?
  WHERE course_name = 'Film Appreciation Course'
  AND user_id IN (
    SELECT bs.student_id
    FROM batch_students bs
    JOIN batches b ON bs.batch_id = b.id
    WHERE b.batch_name IN (
      '1st Batch', '2nd Batch', '3rd Batch', '4th Batch', '5th Batch',
      '6th Batch', '7th Batch', '8th Batch', '9th Batch', '10th Batch',
      '11th Batch', '12th Batch', '13th Batch', '14th Batch', '15th Batch',
      '16th Batch', '17th Batch', '18th Batch', '19th Batch', '20th Batch',
      '21st Batch', '22nd Batch'
    )
  )
`).run(paidFeeDetails);

console.log(`Updated fee details to Paid Full for ${result.changes} enrollments in batches 1-22.`);
