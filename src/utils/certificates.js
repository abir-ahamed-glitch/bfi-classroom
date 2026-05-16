import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const backendOrigin = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

function resolveAssetUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  if (url.startsWith('/media/')) return `${backendOrigin}${url}`;
  return new URL(url.replace(/^\//, ''), `${window.location.origin}${import.meta.env.BASE_URL}`).toString();
}

// 50 popular fonts (matching the designer)
const FONTS = [
  'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana',
  'Playfair Display', 'Merriweather', 'Pinyon Script', 'Great Vibes',
  'Alex Brush', 'Parisienne', 'Cinzel', 'Cormorant Garamond', 'Lora',
  'Tangerine', 'Dancing Script', 'Pacifico', 'Allura', 'Montserrat',
  'Roboto', 'Open Sans', 'Lato', 'Oswald', 'Raleway', 'Nunito',
  'Ubuntu', 'Poppins', 'Inter', 'Rubik', 'Noto Serif', 'EB Garamond',
  'Crimson Text', 'Josefin Sans', 'Anton', 'Libre Baskerville',
  'Bebas Neue', 'Righteous', 'Permanent Marker', 'Amatic SC',
  'Shadows Into Light', 'Caveat', 'Satisfy', 'Sacramento', 'Yellowtail',
  'Kalam', 'Cookie', 'Courgette', 'Leckerli One', 'Marck Script', 'Grand Hotel'
];

const FIELD_RENDER_ORDER = ['bodyText', 'studentId', 'completionDate'];

const FIELD_COLORS = {
  studentId: '#2563eb',
  completionDate: '#3b82f6',
  bodyText: '#1e293b',
};

const FONT_SCALE = {
  bodyText: 0.055,
  standard: 0.08,
};

const BODY_PADDING = {
  block: 0.36,
  inline: 0.54,
};

const DEFAULT_POSITIONS = {
  studentId:      { x: 26, y: 26, fontSize: 14, width: 20, height: 6, fontFamily: 'Times New Roman', fontWeight: 'bold', fontStyle: 'normal', align: 'center', color: FIELD_COLORS.studentId },
  completionDate: { x: 80, y: 26, fontSize: 14, width: 20, height: 6, fontFamily: 'Times New Roman', fontWeight: 'bold', fontStyle: 'normal', align: 'center', color: FIELD_COLORS.completionDate },
  bodyText:       { x: 50, y: 72, fontSize: 14, width: 72, height: 18, fontFamily: 'Times New Roman', fontWeight: 'normal', fontStyle: 'normal', align: 'center', color: FIELD_COLORS.bodyText },
};

const normalizePositions = (saved = {}) => {
  return FIELD_RENDER_ORDER.reduce((acc, field) => ({
    ...acc,
    [field]: {
      ...DEFAULT_POSITIONS[field],
      ...(saved[field] || {}),
    },
  }), {});
};

// Inject Google Fonts before rendering
function ensureFontsLoaded() {
  const googleFonts = FONTS.filter(f => !['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'].includes(f));
  const linkId = 'cert-google-fonts';
  if (!document.getElementById(linkId)) {
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?' + googleFonts.map(f => `family=${f.replace(/ /g, '+')}`).join('&') + '&display=swap';
    document.head.appendChild(link);
  }
}

export async function downloadCertificatePdf(certificate, template = {}) {
  ensureFontsLoaded();
  await document.fonts.ready;

  const { fullName, studentId, batchNumber, completionDate } = certificate.studentDetails;
  const dateStr = new Date(completionDate).toLocaleDateString('en-GB');

  let positions = normalizePositions();
  let bodyTemplate = 'This is to certify that Mr./Ms. {Student Name} has passed the Three Month Long Online Filmmaking Course of {Batch Number} Batch directed by Tanvir Mokammel and organized by Bangladesh Film Institute (BFI).';

  if (template.layout_json) {
    try {
      const parsed = JSON.parse(template.layout_json);
      if (parsed.positions) positions = normalizePositions(parsed.positions);
      if (parsed.bodyTemplate) bodyTemplate = parsed.bodyTemplate;
    } catch (error) {
      console.error('Failed to parse certificate layout', error);
    }
  }

  // Create an offscreen container perfectly matching the canvas aspect ratio
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  // Use a high resolution for crisp PDF (e.g., ~2970x2100 for A4 at 254 DPI)
  const renderWidth = 2970;
  const renderHeight = 2100;
  container.style.width = `${renderWidth}px`;
  container.style.height = `${renderHeight}px`;
  container.style.backgroundColor = '#f8fafc';
  container.style.overflow = 'hidden';

  if (template.background_url) {
    container.style.backgroundImage = `url(${resolveAssetUrl(template.background_url)})`;
    container.style.backgroundSize = '100% 100%';
    container.style.backgroundPosition = 'center';
    container.style.backgroundRepeat = 'no-repeat';
  }

  const addFieldToDom = (fieldKey, textContent) => {
    if (!textContent) return;
    const pos = positions[fieldKey];
    if (!pos) return;
    const isBody = fieldKey === 'bodyText';

    const box = document.createElement('div');
    const widthPct = pos.width || 20;
    const heightPct = pos.height || 6;
    box.style.position = 'absolute';
    box.style.left = `${pos.x - widthPct / 2}%`;
    box.style.top = `${pos.y - heightPct / 2}%`;
    box.style.width = `${widthPct}%`;
    box.style.height = `${heightPct}%`;
    box.style.display = 'flex';
    box.style.boxSizing = 'border-box';
    box.style.overflow = 'visible';

    const fontMultiplier = isBody ? FONT_SCALE.bodyText : FONT_SCALE.standard;
    const computedFontSize = (pos.fontSize || 14) * (fontMultiplier / 100) * renderWidth;

    if (isBody) {
      box.style.flexDirection = 'column';
      box.style.alignItems = 'stretch';
      box.style.justifyContent = 'flex-start';
      box.style.padding = `${BODY_PADDING.block / 100 * renderWidth}px ${BODY_PADDING.inline / 100 * renderWidth}px`;

      const content = document.createElement('div');
      content.style.width = '100%';
      content.style.fontSize = `${computedFontSize}px`;
      content.style.fontFamily = `"${pos.fontFamily || 'Times New Roman'}", sans-serif`;
      content.style.fontWeight = pos.fontWeight === 'bold' ? '700' : '400';
      content.style.fontStyle = pos.fontStyle || 'normal';
      content.style.color = pos.color || FIELD_COLORS[fieldKey] || '#0f172a';
      content.style.textAlign = pos.align || 'center';
      content.style.lineHeight = '1.5';
      content.style.wordBreak = 'break-word';
      content.innerHTML = textContent;
      box.appendChild(content);
    } else {
      box.style.alignItems = 'center';
      box.style.justifyContent = pos.align === 'left' ? 'flex-start' : pos.align === 'right' ? 'flex-end' : 'center';

      const span = document.createElement('span');
      span.style.whiteSpace = 'nowrap';
      span.style.fontSize = `${computedFontSize}px`;
      span.style.fontFamily = `"${pos.fontFamily || 'Times New Roman'}", sans-serif`;
      span.style.fontWeight = pos.fontWeight === 'bold' ? '700' : '400';
      span.style.fontStyle = pos.fontStyle || 'normal';
      span.style.color = pos.color || FIELD_COLORS[fieldKey] || '#0f172a';
      span.style.textAlign = pos.align || 'center';
      span.textContent = textContent;
      box.appendChild(span);
    }

    container.appendChild(box);
  };

const getOrdinalSuffixHTML = (str) => {
  if (!str) return str;
  const numMatch = String(str).match(/\d+/);
  if (!numMatch) return str;
  
  const num = parseInt(numMatch[0], 10);
  const j = num % 10, k = num % 100;
  let suffix = 'th';
  if (j === 1 && k !== 11) suffix = 'st';
  else if (j === 2 && k !== 12) suffix = 'nd';
  else if (j === 3 && k !== 13) suffix = 'rd';
  
  return String(str).replace(/\d+\s*(?:st|nd|rd|th)?/i, `${num}<sup>${suffix}</sup>`);
};

  const tagOrSpace = '(?:\\s|&nbsp;|<[^>]+>)*';
  const fillRichPlaceholder = (html, firstWord, secondWord, value) => String(html || '')
    .replace(
      new RegExp(`\\{(${tagOrSpace})${firstWord}(${tagOrSpace})${secondWord}(${tagOrSpace})\\}`, 'gi'),
      (_match, before, _between, after) => `${before}${value || ''}${after}`
    );
  const fillTemplatePlaceholders = (html) => fillRichPlaceholder(
    fillRichPlaceholder(html, 'Student', 'Name', fullName),
    'Batch',
    'Number',
    getOrdinalSuffixHTML(batchNumber)
  );

  const fullSentence = fillTemplatePlaceholders(bodyTemplate);
  addFieldToDom('bodyText', fullSentence);
  addFieldToDom('studentId', studentId);
  addFieldToDom('completionDate', dateStr);

  document.body.appendChild(container);

  // Give DOM a tiny moment to composite the fonts/images
  await new Promise(r => setTimeout(r, 150));

  const canvas = await html2canvas(container, {
    scale: 1, // Keep original 3K resolution
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff'
  });

  document.body.removeChild(container);

  // Use JPEG at maximum quality (1.0) to achieve a file size around 2-3MB
  const imgData = canvas.toDataURL('image/jpeg', 1.0);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const pdfWidth = doc.internal.pageSize.getWidth();
  const pdfHeight = doc.internal.pageSize.getHeight();
  doc.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

  const safeCourseName = certificate.courseName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const safeStudentId  = String(studentId).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  doc.save(`bfi-certificate-${safeStudentId}-${safeCourseName}.pdf`);
}
