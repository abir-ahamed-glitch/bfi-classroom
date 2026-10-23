const fs = require('fs');
const path = require('path');

const batchDetailPath = path.join(__dirname, 'src', 'pages', 'admin', 'BatchDetail.jsx');
let content = fs.readFileSync(batchDetailPath, 'utf8');

// 1. Add hook import
if (!content.includes('useCourseSettings')) {
  content = content.replace(
    "import BatchFormModal from '../../components/admin/BatchFormModal';",
    "import { useCourseSettings } from '../../hooks/useCourseSettings';\nimport BatchFormModal from '../../components/admin/BatchFormModal';"
  );
}

// 2. Add hook call inside BatchDetail component
const hookCall = `
  const { courseSettings, getSetting, loading: settingsLoading } = useCourseSettings();
  const currentCourseSetting = useMemo(() => {
    if (!batchData || settingsLoading) return null;
    return getSetting(batchData.course_name, batchData.batch_number);
  }, [batchData, courseSettings, settingsLoading, getSetting]);
`;

if (!content.includes('const { courseSettings, getSetting, loading: settingsLoading } = useCourseSettings();')) {
  content = content.replace(
    "const [studentsData, setStudentsData] = useState([]);",
    hookCall + "\n  const [studentsData, setStudentsData] = useState([]);"
  );
}

// 3. Update academicFormData to handle dynamic assignments via assignment_scores
// But wait, the previous code had assignment_screenplay and assignment_shooting_script.
// Let's replace the useState for academicFormData.
content = content.replace(
  `  const [academicFormData, setAcademicFormData] = useState({
    attendance_classes: '', attendance_total: '', exam_written: '',
    assignment_screenplay: '', assignment_shooting_script: ''
  });`,
  `  const [academicFormData, setAcademicFormData] = useState({
    attendance_classes: '', attendance_total: '', exam_written: '', assignment_scores: {}
  });`
);

// 4. Update getAcademicValidationError to use currentCourseSetting
const valErrorStart = `  const getAcademicValidationError = () => {`;
const valErrorEnd = `    return null;
  };`;

// We will replace the body of getAcademicValidationError.
// I will use regex or string replace.
const valErrorReplacement = `  const getAcademicValidationError = () => {
    if (!academicStudent || !currentCourseSetting) return null;
    
    const attendanceStr = academicFormData.attendance_classes;
    const totalAttendanceStr = academicFormData.attendance_total;
    
    if (attendanceStr === '' || attendanceStr === undefined || attendanceStr === null) return 'Classes Attended is required.';
    if (totalAttendanceStr === '' || totalAttendanceStr === undefined || totalAttendanceStr === null) return 'Total Classes is required.';
    
    const attendance = parseInt(attendanceStr) || 0;
    const totalAttendance = parseInt(totalAttendanceStr) || 0;

    if (attendance > totalAttendance) return 'Attended classes cannot exceed total classes.';
    if (attendance < 0) return 'Attended classes cannot be negative.';
    if (totalAttendance < 1) return 'Total classes must be at least 1.';

    const examStr = academicFormData.exam_written;
    if (examStr === '' || examStr === undefined || examStr === null) return 'Written exam score is required.';
    
    const exam = parseInt(examStr) || 0;
    if (exam > currentCourseSetting.exam_max_score) return \`Written exam score cannot exceed \${currentCourseSetting.exam_max_score}.\`;
    if (exam < 0) return 'Written exam score cannot be negative.';
    
    if (currentCourseSetting.has_assignment) {
      let definedAssignments = [];
      try {
        definedAssignments = JSON.parse(currentCourseSetting.assignments || '[]');
      } catch(e) {}
      
      for (const def of definedAssignments) {
        const score = parseFloat(academicFormData.assignment_scores?.[def.id] || 0);
        if (score > def.max_score) return \`\${def.name} score cannot exceed \${def.max_score}.\`;
        if (score < 0) return \`\${def.name} score cannot be negative.\`;
      }
    }
    return null;
  };`;

const startIndex = content.indexOf(valErrorStart);
let endIndex = content.indexOf('return null;\n  };', startIndex);
if(endIndex === -1) endIndex = content.indexOf('return null;\r\n  };', startIndex);

if (startIndex !== -1 && endIndex !== -1) {
  content = content.substring(0, startIndex) + valErrorReplacement + content.substring(endIndex + (content.indexOf('\r\n') !== -1 ? 16 : 15));
}

// 5. Replace openAcademicModal
// When opening the modal, parse assignment_scores.
content = content.replace(
  `assignment_screenplay: enrollment?.assignment_screenplay || '',
      assignment_shooting_script: enrollment?.assignment_shooting_script || ''`,
  `assignment_scores: enrollment?.assignment_scores ? (typeof enrollment.assignment_scores === 'string' ? JSON.parse(enrollment.assignment_scores) : enrollment.assignment_scores) : {}`
);

fs.writeFileSync(batchDetailPath, content, 'utf8');
console.log('Successfully updated BatchDetail.jsx part 1');
