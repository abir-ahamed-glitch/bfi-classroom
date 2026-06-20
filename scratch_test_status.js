import db from './server/db/database.js';
import { parseFeeDetails, getBatchFee, getFeeStatus, extractFeeAmounts } from './server/utils/feeResolver.js';

const enrollments = db.prepare(`
  SELECT 
    sce.id as enrollment_id,
    sce.course_name,
    sce.course_type,
    sce.fee_details,
    u.id as user_id,
    u.first_name,
    u.last_name,
    sp.student_id,
    sp.batch_number
  FROM student_course_enrollments sce
  JOIN users u ON u.id = sce.user_id
  JOIN student_profiles sp ON sp.user_id = u.id
  WHERE u.first_name LIKE '%Ahamed%' OR u.last_name LIKE '%Ahamed%'
`).all();

for (const row of enrollments) {
  const feeDetails = parseFeeDetails(row.fee_details);
  const batchFee = getBatchFee(row.course_name, row.batch_number);
  const rawStatus = getFeeStatus(feeDetails, row.course_type, batchFee);
  const amounts = extractFeeAmounts(feeDetails, row.course_type, batchFee);

  const total_fee = Math.round(amounts.total);
  const collected = Math.round(amounts.collected);
  const outstanding = Math.max(0, total_fee - collected);

  let explicitStatus = null;
  if (row.course_type === 'filmmaking' && feeDetails && feeDetails.phase1) {
    explicitStatus = feeDetails.phase1.status;
  } else if (row.course_type !== 'filmmaking' && feeDetails) {
    explicitStatus = feeDetails.status;
  }

  let status;
  const exp = (explicitStatus || '').toLowerCase();
  
  if (exp === 'waived' || exp === 'waived / free') {
    status = 'Waived / Free';
  } else if (total_fee > 0 && outstanding === 0) {
    status = 'Paid Full';
  } else if (exp === 'paid full' || rawStatus === 'paid') {
    status = 'Paid Full';
  } else if (exp === 'partial' || exp === 'partial payment' || rawStatus === 'partial') {
    status = 'Partial Payment';
  } else if (exp === 'pending') {
    status = 'Pending';
  } else {
    status = 'Due / Unpaid';
  }

  console.log({
    name: row.first_name + ' ' + row.last_name,
    course: row.course_name,
    total_fee,
    collected,
    outstanding,
    explicitStatus,
    exp,
    rawStatus,
    status
  });
}
