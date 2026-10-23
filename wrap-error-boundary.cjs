const fs = require('fs');
let content = fs.readFileSync('src/pages/admin/AdditionalOptions.jsx', 'utf8');
content = content.replace("import { resolveMediaUrl } from '../../utils/mediaUtils';", "import { resolveMediaUrl } from '../../utils/mediaUtils';\nimport { ErrorBoundary } from '../../components/ErrorBoundary';");
content = content.replace("export default function AdditionalOptions() {", "function AdditionalOptionsContent() {");
content += "\n\nexport default function AdditionalOptions() {\n  return (\n    <ErrorBoundary>\n      <AdditionalOptionsContent />\n    </ErrorBoundary>\n  );\n}";
fs.writeFileSync('src/pages/admin/AdditionalOptions.jsx', content, 'utf8');
console.log('Wrapped AdditionalOptions in ErrorBoundary');
