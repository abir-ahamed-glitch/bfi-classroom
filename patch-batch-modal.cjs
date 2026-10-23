const fs = require('fs');
const path = require('path');

const batchDetailPath = path.join(__dirname, 'src', 'pages', 'admin', 'BatchDetail.jsx');
let content = fs.readFileSync(batchDetailPath, 'utf8');

const dynamicModalRender = `
              {currentCourseSetting ? (
                <>
                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', margin: 0 }}>Attendance</h3>
                      {currentCourseSetting.has_phase2 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <label style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Total classes:</label>
                          <input type="number" name="attendance_total" value={academicFormData.attendance_total} onChange={handleAcademicChange} min="1" className="input-glass" style={{ width: '100px', paddingLeft: '0.5rem', fontSize: '0.9rem' }} required />
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: currentCourseSetting.has_phase2 ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Classes Attended</label>
                        <input type="number" name="attendance_classes" value={academicFormData.attendance_classes} onChange={handleAcademicChange} min="0" max={academicFormData.attendance_total || currentCourseSetting.total_classes} className="input-glass" style={{ paddingLeft: '1rem' }} required />
                        {currentCourseSetting.has_phase2 && (
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Requires {Math.ceil((academicFormData.attendance_total || currentCourseSetting.total_classes) * 0.8)}+ (80%) to qualify for exam.</p>
                        )}
                      </div>
                      {!currentCourseSetting.has_phase2 && (
                        <div>
                          <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Total Classes</label>
                          <input type="number" name="attendance_total" value={academicFormData.attendance_total} onChange={handleAcademicChange} min="1" className="input-glass" style={{ paddingLeft: '1rem' }} required />
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Exam Results (Total: {currentCourseSetting.exam_max_score + (currentCourseSetting.has_assignment ? JSON.parse(currentCourseSetting.assignments||'[]').reduce((acc,a)=>acc+a.max_score,0) : 0)})</h3>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
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
                      
                      const maxTotal = currentCourseSetting.exam_max_score + (currentCourseSetting.has_assignment ? JSON.parse(currentCourseSetting.assignments||'[]').reduce((acc,a)=>acc+a.max_score,0) : 0);
                      
                      return (
                        <div style={{ 
                          marginTop: '1.25rem', 
                          padding: '1rem', 
                          background: 'rgba(0, 0, 0, 0.2)', 
                          borderRadius: '8px', 
                          border: '1px solid var(--glass-border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.75rem'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Passing Requirement:</span>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '500' }}>{currentCourseSetting.exam_pass_mark}+ total marks</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Total Score Gained:</span>
                            <span style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                              {totalGained} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>/ {maxTotal}</span>
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '0.75rem' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Status:</span>
                            <span style={{ 
                              fontSize: '0.72rem', 
                              fontWeight: '600', 
                              padding: '0.15rem 0.5rem', 
                              borderRadius: '4px',
                              background: isPassed ? 'rgba(52, 211, 153, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                              color: isPassed ? '#34d399' : '#f87171',
                              border: isPassed ? '1px solid rgba(52, 211, 153, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em'
                            }}>
                              {isPassed ? 'Passed' : 'Failed'}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading settings...</div>
              )}
`;

const startMarker = `{academicStudent.enrollment?.course_name !== 'Online Filmmaking Course' ? (`.trim();
const endMarker = `              <div className="error-alert" style={{`.trim();

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
  // Move back slightly to align with the `{academic...` start block
  content = content.substring(0, startIndex - 14) + dynamicModalRender + "\n" + content.substring(endIndex);
  fs.writeFileSync(batchDetailPath, content, 'utf8');
  console.log("Successfully replaced modal content");
} else {
  console.error("Could not find modal content markers");
}
