const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'server', 'routes', 'batches.js');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
  "sce.assignment_screenplay,\n        sce.assignment_shooting_script,",
  "sce.assignment_scores,"
);

const progressLogicOld = `
    const phase1 = {
      admitted: 0,
      attendance_qualified: 0,
      attendance_not_qualified: 0,
      screenplay_submitted: 0,
      shooting_script_submitted: 0,
      exam_passed: 0,
      exam_failed: 0,
      completed: 0
    };
`;

const progressLogicNew = `
    let courseSettings = null;
    try {
      courseSettings = db.prepare('SELECT * FROM course_settings WHERE course_name = ? AND batch_number = ?').get(batch.course_name, batch.batch_number);
      if (!courseSettings) {
        courseSettings = db.prepare('SELECT * FROM course_settings WHERE course_name = ? AND batch_number = ?').get(batch.course_name, 'DEFAULT');
      }
    } catch (e) {}

    const phase1 = {
      admitted: 0,
      attendance_qualified: 0,
      attendance_not_qualified: 0,
      exam_passed: 0,
      exam_failed: 0,
      completed: 0,
      assignments: {}
    };
    
    let definedAssignments = [];
    if (courseSettings && courseSettings.has_assignment) {
      try {
        definedAssignments = JSON.parse(courseSettings.assignments || '[]');
        definedAssignments.forEach(def => {
          phase1.assignments[def.id] = 0;
        });
      } catch (e) {}
    }
`;

content = content.replace(progressLogicOld, progressLogicNew);

const oldStudentMetrics = `
        const isQualified = s.attendance_total > 0 && (s.attendance_classes / s.attendance_total >= 0.8);
        if (isQualified) {
          phase1.attendance_qualified++;
        } else {
          phase1.attendance_not_qualified++;
        }

        if (s.assignment_screenplay > 0) phase1.screenplay_submitted++;
        if (s.assignment_shooting_script > 0) phase1.shooting_script_submitted++;
`;

const newStudentMetrics = `
        const attTotal = s.attendance_total || courseSettings?.total_classes || 22;
        const isQualified = attTotal > 0 && (s.attendance_classes / attTotal >= 0.8);
        if (isQualified) {
          phase1.attendance_qualified++;
        } else {
          phase1.attendance_not_qualified++;
        }

        if (courseSettings && courseSettings.has_assignment) {
          try {
            const scores = JSON.parse(s.assignment_scores || '{}');
            definedAssignments.forEach(def => {
              if (parseFloat(scores[def.id]) > 0) {
                phase1.assignments[def.id]++;
              }
            });
          } catch(e) {}
        }
`;

content = content.replace(oldStudentMetrics, newStudentMetrics);

const oldSinglePhaseMetrics = `
        if (s.assignment_screenplay > 0 || s.assignment_shooting_script > 0) single_phase.assignment_submitted++;
`;

const newSinglePhaseMetrics = `
        let hasAnyAssignment = false;
        try {
          const scores = JSON.parse(s.assignment_scores || '{}');
          hasAnyAssignment = Object.values(scores).some(v => parseFloat(v) > 0);
        } catch(e) {}
        if (hasAnyAssignment) single_phase.assignment_submitted++;
`;

content = content.replace(oldSinglePhaseMetrics, newSinglePhaseMetrics);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully patched batches.js for dynamic progress metrics');
