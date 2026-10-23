const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'pages', 'admin', 'AdditionalOptions.jsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add import
if (!content.includes('import CourseSettingsManager from')) {
  content = content.replace("import BatchFeeManager from './BatchFeeManager';", "import BatchFeeManager from './BatchFeeManager';\nimport CourseSettingsManager from './CourseSettingsManager';");
}

// 2. Add the card button
const cardReplacement = `
          <button
            onClick={() => setCurrentView('course-settings')}
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--glass-border)',
              borderRadius: '16px',
              padding: '2rem',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              position: 'relative',
              overflow: 'hidden',
              color: 'inherit'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
              e.currentTarget.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
              e.currentTarget.style.borderColor = 'var(--glass-border)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{
              background: 'rgba(225, 29, 72, 0.1)',
              color: 'var(--accent-primary)',
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Settings size={24} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
                Course Settings Manager
              </h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Configure global and batch-specific course settings, including total classes, exam scores, passing marks, and assignments.
              </p>
            </div>
          </button>
`;

if (!content.includes("Course Settings Manager")) {
  const marker = "<button\n            onClick={() => setCurrentView('batch-fees')}";
  content = content.replace(marker, cardReplacement + "\n          " + marker);
}

// 3. Add the view render
const viewRenderReplacement = `
          {currentView === 'course-settings' && (
            <CourseSettingsManager />
          )}

          {currentView === 'batch-fees' && (
`;

if (!content.includes("<CourseSettingsManager />")) {
  const viewMarker = "{currentView === 'batch-fees' && (";
  content = content.replace(viewMarker, viewRenderReplacement);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated AdditionalOptions.jsx with CourseSettingsManager.');
