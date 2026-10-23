const fs = require('fs');
let content = fs.readFileSync('src/pages/admin/BatchDetail.jsx', 'utf8');

// 1. Imports
if (!content.includes('import { useCourseSettings }')) {
  content = content.replace("import { Trash2, AlertCircle, X, Download } from 'lucide-react';", "import { Trash2, AlertCircle, X, Download } from 'lucide-react';\nimport { useCourseSettings } from '../../hooks/useCourseSettings';");
}

// 2. Hook setup
if (!content.includes('const { courseSettings, getSetting, loading: settingsLoading } = useCourseSettings();')) {
  content = content.replace(
    "const [recentlyToggledIds, setRecentlyToggledIds] = useState([]);",
    "const [recentlyToggledIds, setRecentlyToggledIds] = useState([]);\n\n  const { courseSettings, getSetting, loading: settingsLoading } = useCourseSettings();\n  const currentCourseSetting = useMemo(() => {\n    if (!batchData || settingsLoading) return null;\n    return getSetting(batchData.course_name, batchData.batch_number);\n  }, [batchData, courseSettings, settingsLoading, getSetting]);"
  );
}

// 3. academicFormData state
content = content.replace(
  /const \[academicFormData, setAcademicFormData\] = useState\(\{\n\s*attendance_classes: '', attendance_total: '', exam_written: '',\n\s*assignment_screenplay: '', assignment_shooting_script: ''\n\s*\}\);/,
  "const [academicFormData, setAcademicFormData] = useState({\n    attendance_classes: '', attendance_total: '', exam_written: '',\n    assignment_scores: {}\n  });"
);

// 4. openAcademicModal
content = content.replace(
  /assignment_screenplay: enrollment\?\.assignment_screenplay \|\| '',\n\s*assignment_shooting_script: enrollment\?\.assignment_shooting_script \|\| ''/,
  "assignment_scores: typeof enrollment?.assignment_scores === 'string' ? JSON.parse(enrollment.assignment_scores || '{}') : (enrollment?.assignment_scores || {}),"
);

// 5. getAcademicValidationError
const origValidation = `  const getAcademicValidationError = () => {
    if (!academicStudent) return null;
    const isOnlineFilmmaking = academicStudent.enrollment?.course_name === 'Online Filmmaking Course';

    const attendance = parseInt(academicFormData.attendance_classes) || 0;
    const totalAttendanceStr = academicFormData.attendance_total || (isOnlineFilmmaking ? '22' : '');
    if (isOnlineFilmmaking && !totalAttendanceStr) return 'Total classes is required.';
    const totalAttendance = parseInt(totalAttendanceStr) || 0;

    if (attendance > totalAttendance) return 'Attended classes cannot exceed total classes.';
    if (attendance < 0) return 'Attended classes cannot be negative.';
    if (isOnlineFilmmaking && totalAttendance < 1) return 'Total classes must be at least 1.';

    const examStr = academicFormData.exam_written;
    if (examStr === '' || examStr === undefined || examStr === null) return 'Written exam score is required.';
    
    const exam = parseInt(examStr) || 0;
    if (exam > 80) return 'Written exam score cannot exceed 80.';
    if (exam < 0) return 'Written exam score cannot be negative.';

    const screenplayStr = academicFormData.assignment_screenplay;
    if (screenplayStr !== '' && screenplayStr !== null && screenplayStr !== undefined) {
      const screenplay = parseInt(screenplayStr) || 0;
      if (screenplay > 10) return 'Screenplay assignment score cannot exceed 10.';
      if (screenplay < 0) return 'Screenplay assignment score cannot be negative.';
    }

    const shootingScriptStr = academicFormData.assignment_shooting_script;
    if (shootingScriptStr !== '' && shootingScriptStr !== null && shootingScriptStr !== undefined) {
      const shootingScript = parseInt(shootingScriptStr) || 0;
      if (shootingScript > 10) return 'Shooting Script assignment score cannot exceed 10.';
      if (shootingScript < 0) return 'Shooting Script assignment score cannot be negative.';
    }

    return null;
  };`;

const newValidation = `  const getAcademicValidationError = () => {
    if (!academicStudent || !currentCourseSetting) return null;
    
    const attendance = parseInt(academicFormData.attendance_classes) || 0;
    const totalAttendanceStr = academicFormData.attendance_total || currentCourseSetting.total_classes || '';
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

if (content.includes(origValidation)) {
  content = content.replace(origValidation, newValidation);
}

// 6. StatCards
const oldStatCards = `<StatCard icon={<FileText size={20} />} value={progressData.phase1?.screenplay_submitted} label="Screenplay Submitted" colorVariant="Amber" onClick={() => toggleStatFilter('screenplay_submitted')} isActive={selectedStatFilter === 'screenplay_submitted'} />
                  <StatCard icon={<Film size={20} />} value={progressData.phase1?.shooting_script_submitted} label="Shooting Script Submitted" colorVariant="Amber" onClick={() => toggleStatFilter('shooting_script_submitted')} isActive={selectedStatFilter === 'shooting_script_submitted'} />`;

const newStatCards = `{(() => {
                    if (!currentCourseSetting || !currentCourseSetting.has_assignment) return null;
                    let defs = [];
                    try { defs = JSON.parse(currentCourseSetting.assignments || '[]'); } catch(e){}
                    return defs.map(def => (
                      <StatCard 
                        key={def.id}
                        icon={<FileText size={20} />} 
                        value={progressData.phase1?.assignments?.[def.id] || 0} 
                        label={\`\${def.name} Submitted\`} 
                        colorVariant="Amber" 
                        onClick={() => toggleStatFilter('assignment_' + def.id)} 
                        isActive={selectedStatFilter === 'assignment_' + def.id} 
                      />
                    ));
                  })()}`;

if (content.includes(oldStatCards)) {
  content = content.replace(oldStatCards, newStatCards);
}

// 7. Filters
content = content.replace(
  "        case 'screenplay_submitted':\n          return enrollment && enrollment.assignment_screenplay > 0;",
  "        case 'screenplay_submitted': {\n          let pScores = {};\n          try { pScores = JSON.parse(enrollment?.assignment_scores || '{}'); } catch(e){}\n          return enrollment && pScores['screenplay'] > 0;\n        }"
);
content = content.replace(
  "        case 'shooting_script_submitted':\n          return enrollment && (enrollment.assignment_screenplay > 0 || enrollment.assignment_shooting_script > 0);",
  "        case 'shooting_script_submitted': {\n          let pScores = {};\n          try { pScores = JSON.parse(enrollment?.assignment_scores || '{}'); } catch(e){}\n          return enrollment && pScores['shooting_script'] > 0;\n        }"
);

// 8. totalScore calculation
const oldTotalScore = `                                    const totalScore = (parseInt(e.exam_written) || 0) + (parseInt(e.assignment_screenplay) || 0) + (parseInt(e.assignment_shooting_script) || 0);`;
const newTotalScore = `                                    let eAssignmentsTotal = 0;
                                    if (currentCourseSetting?.has_assignment) {
                                      try {
                                        const pScores = JSON.parse(e.assignment_scores || '{}');
                                        const defs = JSON.parse(currentCourseSetting.assignments || '[]');
                                        defs.forEach(d => { eAssignmentsTotal += parseFloat(pScores[d.id]) || 0; });
                                      } catch(err) {}
                                    }
                                    const totalScore = (parseInt(e.exam_written) || 0) + eAssignmentsTotal;`;

if (content.includes(oldTotalScore)) {
  content = content.replace(oldTotalScore, newTotalScore);
}

// 9. Modal UI
const oldModalUI = `                      <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Written Exam (Max: 80)</label>
                        <input type="number" name="exam_written" value={academicFormData.exam_written} onChange={handleAcademicChange} min="0" max="80" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Screenplay (Max: 10)</label>
                          <input type="number" name="assignment_screenplay" value={academicFormData.assignment_screenplay} onChange={handleAcademicChange} min="0" max="10" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                        </div>
                        <div>
                          <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Shooting Script (Max: 10)</label>
                          <input type="number" name="assignment_shooting_script" value={academicFormData.assignment_shooting_script} onChange={handleAcademicChange} min="0" max="10" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                        </div>
                      </div>
                    </div>
                    {(() => {
                      const totalGained = (parseInt(academicFormData.exam_written) || 0) + 
                                          (parseInt(academicFormData.assignment_screenplay) || 0) + 
                                          (parseInt(academicFormData.assignment_shooting_script) || 0);
                      const isPassed = totalGained >= 33;`;

const newModalUI = `                      <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Written Exam (Max: {currentCourseSetting.exam_max_score})</label>
                        <input type="number" name="exam_written" value={academicFormData.exam_written} onChange={handleAcademicChange} min="0" max={currentCourseSetting.exam_max_score} className="input-glass" style={{ paddingLeft: '1rem' }} required />
                      </div>
                      {currentCourseSetting.has_assignment && (() => {
                        let definedAssignments = [];
                        try {
                          definedAssignments = JSON.parse(currentCourseSetting.assignments || '[]');
                        } catch(e) {}
                        
                        return (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            {definedAssignments.map(def => (
                              <div key={def.id}>
                                <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{def.name} (Max: {def.max_score})</label>
                                <input 
                                  type="number" 
                                  value={academicFormData.assignment_scores?.[def.id] || ''} 
                                  onChange={e => setAcademicFormData(prev => ({
                                    ...prev,
                                    assignment_scores: { ...prev.assignment_scores, [def.id]: e.target.value }
                                  }))} 
                                  min="0" max={def.max_score} 
                                  className="input-glass" style={{ paddingLeft: '1rem' }} 
                                  required 
                                />
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    {(() => {
                      let assignmentsTotal = 0;
                      if (currentCourseSetting.has_assignment) {
                        let definedAssignments = [];
                        try { definedAssignments = JSON.parse(currentCourseSetting.assignments || '[]'); } catch(e) {}
                        for (const def of definedAssignments) {
                          assignmentsTotal += parseFloat(academicFormData.assignment_scores?.[def.id] || 0);
                        }
                      }
                      const totalGained = (parseInt(academicFormData.exam_written) || 0) + assignmentsTotal;
                      const isPassed = totalGained >= currentCourseSetting.exam_pass_mark;
                      const maxTotal = currentCourseSetting.exam_max_score + (currentCourseSetting.has_assignment ? JSON.parse(currentCourseSetting.assignments||'[]').reduce((acc,a)=>acc+a.max_score,0) : 0);`;

if (content.includes(oldModalUI)) {
  content = content.replace(oldModalUI, newModalUI);
}

// Passmark
content = content.replace(
  "33+ total marks",
  "{currentCourseSetting.exam_pass_mark}+ total marks"
);
content = content.replace(
  "{totalGained} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>/ 100</span>",
  "{totalGained} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>/ {maxTotal}</span>"
);

// Add condition for the modal wrapper so it doesn't crash if currentCourseSetting is missing
content = content.replace(
  /                  <div style=\{\{ display: 'flex', flexDirection: 'column', gap: '1.25rem' \}\}>/g,
  "                  {currentCourseSetting ? (\n                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>"
);

content = content.replace(
  /                    \}\)\(\)\} \n                  <\/div>\n                <\/>/,
  "                    })()}\n                  </div>\n                </>\n              ) : (\n                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading settings...</div>\n              )}"
);

fs.writeFileSync('src/pages/admin/BatchDetail.jsx', content, 'utf8');
console.log('Successfully repatched BatchDetail.jsx');
