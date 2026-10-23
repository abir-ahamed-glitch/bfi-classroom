const fs = require('fs');
const path = require('path');

const batchDetailPath = path.join(__dirname, 'src', 'pages', 'admin', 'BatchDetail.jsx');
let content = fs.readFileSync(batchDetailPath, 'utf8');

const dynamicStatCards = `
                  {(() => {
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
                  })()}
`;

const regex = /<StatCard icon={<FileText size={20} \/>} value={progressData\.phase1\?\.screenplay_submitted}[\s\S]*?isActive={selectedStatFilter === 'shooting_script_submitted'} \/>/;
content = content.replace(regex, dynamicStatCards.trim());

// Also remove `assignment_screenplay` and `assignment_shooting_script` from the hook inside `BatchDetail.jsx`
content = content.replace(
  "sce.assignment_screenplay,\n        sce.assignment_shooting_script,",
  "sce.assignment_scores,"
);

fs.writeFileSync(batchDetailPath, content, 'utf8');
console.log('Successfully patched BatchDetail.jsx StatCards');
