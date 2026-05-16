import { useState, useEffect, useRef } from 'react';
import { Save, CheckCircle2, Image as ImageIcon, UploadCloud, Trash2, Award, Move, ChevronDown, Type, Bold, Italic, Underline, Strikethrough, Superscript, Subscript, AlignLeft, AlignCenter, AlignRight, AlignJustify, Minus, Plus, Palette } from 'lucide-react';

const COURSES = ['Online Filmmaking Course','Film Appreciation Course','Script Writing','Cinematography','Acting'];
const API_BASE = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

const DEFAULT_BODY = 'This is to certify that Mr./Ms. {Student Name} has passed the Three Month Long Online Filmmaking Course of {Batch Number} Batch directed by Tanvir Mokammel and organized by Bangladesh Film Institute (BFI).';
const PREVIEW_STUDENT_NAME = 'Student Name';
const PREVIEW_BATCH_NUMBER = '00';

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

const BODY_FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48];

function RichTextEditor({ value, onChange }) {
  const editorRef = useRef(null);
  const savedRange = useRef(null);

  const [activeFormats, setActiveFormats] = useState({});

  useEffect(() => {
    if (!editorRef.current || document.activeElement === editorRef.current) return;
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const saveSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current?.contains(selection.anchorNode)) return;
    savedRange.current = selection.getRangeAt(0);
    
    let fontName = document.queryCommandValue('fontName') || '';
    fontName = fontName.replace(/['"]/g, '');

    let foreColor = document.queryCommandValue('foreColor');
    if (foreColor && foreColor.startsWith('rgb')) {
      const rgb = foreColor.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        foreColor = '#' + rgb.slice(0,3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
      }
    }

    let fontSize = '';
    const parent = selection.anchorNode.nodeType === 3 ? selection.anchorNode.parentNode : selection.anchorNode;
    const span = parent.closest ? parent.closest('span[style*="font-size"]') : null;
    if (span) {
       const emVal = parseFloat(span.style.fontSize);
       if (!isNaN(emVal)) {
          fontSize = Math.round(emVal * 14).toString();
       }
    }

    // Check for Uppercase & Small Caps
    let isUppercase = false;
    let isSmallCaps = false;
    let node = selection.anchorNode;
    while (node && node !== editorRef.current) {
      if (node.nodeType === 1) {
        if (node.style.textTransform === 'uppercase') isUppercase = true;
        if (node.style.fontVariant === 'small-caps') isSmallCaps = true;
      }
      node = node.parentNode;
    }

    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strikeThrough: document.queryCommandState('strikeThrough'),
      superscript: document.queryCommandState('superscript'),
      subscript: document.queryCommandState('subscript'),
      justifyLeft: document.queryCommandState('justifyLeft'),
      justifyCenter: document.queryCommandState('justifyCenter'),
      justifyRight: document.queryCommandState('justifyRight'),
      justifyFull: document.queryCommandState('justifyFull'),
      uppercase: isUppercase,
      smallCaps: isSmallCaps,
      fontName: fontName,
      fontSize: fontSize,
      foreColor: foreColor
    });
  };

  const restoreSelection = () => {
    const selection = window.getSelection();
    if (!selection || !savedRange.current) return;
    selection.removeAllRanges();
    selection.addRange(savedRange.current);
  };

  const syncValue = () => {
    onChange(editorRef.current?.innerHTML || '');
    saveSelection();
  };

  const normalizeFontSize = (size) => {
    if (!editorRef.current) return;
    editorRef.current.querySelectorAll('font[size="7"]').forEach(node => {
      const span = document.createElement('span');
      span.style.fontSize = `${Number(size) / 14}em`;
      span.innerHTML = node.innerHTML;
      node.replaceWith(span);
    });
  };

  const handleAction = (e, cmd, val = null) => {
    e.preventDefault();
    restoreSelection();
    document.execCommand(cmd, false, val);
    syncValue();
  };

  const handleTransform = (e, transformType) => {
    e.preventDefault();
    restoreSelection();
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;

    let node = sel.anchorNode;
    let existingSpan = null;
    while (node && node !== editorRef.current) {
      if (node.nodeType === 1 && (node.style.textTransform === 'uppercase' || node.style.fontVariant === 'small-caps')) {
        existingSpan = node;
        break;
      }
      node = node.parentNode;
    }

    if (existingSpan) {
      // Toggle off logic
      if (transformType === 'uppercase' && existingSpan.style.textTransform === 'uppercase') {
        existingSpan.style.textTransform = '';
      } else if (transformType === 'small-caps' && existingSpan.style.fontVariant === 'small-caps') {
        existingSpan.style.fontVariant = '';
      } else {
        existingSpan.style.textTransform = transformType === 'uppercase' ? 'uppercase' : '';
        existingSpan.style.fontVariant = transformType === 'small-caps' ? 'small-caps' : '';
      }
      syncValue();
      return;
    }

    // Apply new transform wrap
    const range = sel.getRangeAt(0);
    const frag = range.cloneContents();
    const div = document.createElement('div');
    div.appendChild(frag);
    let html = div.innerHTML;

    const style = transformType === 'uppercase' ? 'text-transform: uppercase;' : 'font-variant: small-caps;';
    const wrapper = `<span style="${style}">${html}</span>`;
    document.execCommand('insertHTML', false, wrapper);
    syncValue();
  };

  const handleFontChange = (e) => {
    e.preventDefault();
    restoreSelection();
    document.execCommand('fontName', false, e.target.value);
    syncValue();
  };

  const handleSizeChange = (e) => {
    e.preventDefault();
    restoreSelection();
    document.execCommand('fontSize', false, '7');
    normalizeFontSize(e.target.value);
    syncValue();
  };

  const handleColorChange = (e) => {
    restoreSelection();
    document.execCommand('foreColor', false, e.target.value);
    syncValue();
  };

  const insertPlaceholder = (placeholder) => {
    restoreSelection();
    document.execCommand('insertText', false, placeholder);
    syncValue();
  };

  const btnStyle = (cmd) => ({
    background: activeFormats[cmd] ? 'var(--accent-primary)' : 'none',
    border: 'none',
    color: activeFormats[cmd] ? '#fff' : 'var(--text-primary)',
    cursor: 'pointer',
    padding: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    transition: 'background 0.2s, color 0.2s'
  });

  return (
    <div style={{border: '1px solid var(--glass-border)', borderRadius: '8px', overflow: 'hidden', background: 'rgba(255,255,255,0.02)'}}>
      <div style={{display: 'flex', gap: '4px', padding: '6px', background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid var(--glass-border)', flexWrap: 'wrap', alignItems:'center'}}>
        <button onMouseDown={e => handleAction(e, 'bold')} style={btnStyle('bold')} title="Bold"><Bold size={14}/></button>
        <button onMouseDown={e => handleAction(e, 'italic')} style={btnStyle('italic')} title="Italic"><Italic size={14}/></button>
        <button onMouseDown={e => handleAction(e, 'underline')} style={btnStyle('underline')} title="Underline"><Underline size={14}/></button>
        <button onMouseDown={e => handleAction(e, 'strikeThrough')} style={btnStyle('strikeThrough')} title="Strikethrough"><Strikethrough size={14}/></button>
        <div style={{width:'1px', height: '18px', background:'var(--glass-border)', margin:'0 4px'}} />
        <button onMouseDown={e => handleTransform(e, 'uppercase')} style={btnStyle('uppercase')} title="All Caps">
          <span style={{fontFamily:'serif',fontWeight:'bold',fontSize:'13px',letterSpacing:'-0.5px'}}>TT</span>
        </button>
        <button onMouseDown={e => handleTransform(e, 'small-caps')} style={btnStyle('smallCaps')} title="Small Caps">
          <span style={{fontFamily:'serif',fontWeight:'bold',fontSize:'13px',letterSpacing:'-0.5px'}}>T<small style={{fontSize:'10px'}}>t</small></span>
        </button>
        <button onMouseDown={e => handleAction(e, 'superscript')} style={btnStyle('superscript')} title="Superscript"><Superscript size={14}/></button>
        <button onMouseDown={e => handleAction(e, 'subscript')} style={btnStyle('subscript')} title="Subscript"><Subscript size={14}/></button>
        <div style={{width:'1px', height: '18px', background:'var(--glass-border)', margin:'0 4px'}} />
        <button onMouseDown={e => handleAction(e, 'justifyLeft')} style={btnStyle('justifyLeft')} title="Align Left"><AlignLeft size={14}/></button>
        <button onMouseDown={e => handleAction(e, 'justifyCenter')} style={btnStyle('justifyCenter')} title="Align Center"><AlignCenter size={14}/></button>
        <button onMouseDown={e => handleAction(e, 'justifyRight')} style={btnStyle('justifyRight')} title="Align Right"><AlignRight size={14}/></button>
        <button onMouseDown={e => handleAction(e, 'justifyFull')} style={btnStyle('justifyFull')} title="Justify"><AlignJustify size={14}/></button>
        <div style={{width:'1px', height: '18px', background:'var(--glass-border)', margin:'0 4px'}} />
        <select value={activeFormats.fontName || ''} onMouseDown={saveSelection} onChange={handleFontChange} style={{background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', borderRadius: '4px', padding: '4px', fontSize: '0.75rem', outline:'none', cursor:'pointer'}}>
          <option value="">Font...</option>
          {FONTS.map(f => (
            <option key={f} value={f} style={{fontFamily: f}}>{f}</option>
          ))}
        </select>
        <select value={activeFormats.fontSize || ''} onMouseDown={saveSelection} onChange={handleSizeChange} style={{background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', borderRadius: '4px', padding: '2px', fontSize: '0.75rem', outline:'none', cursor:'pointer'}}>
          <option value="">Size...</option>
          {BODY_FONT_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
        </select>
        <label style={{display:'flex',alignItems:'center',gap:'4px',height:'23px',padding:'2px 5px',border:'1px solid var(--glass-border)',borderRadius:'4px',cursor:'pointer',color:'var(--text-primary)'}} title="Text color">
          <Palette size={13}/>
          <input type="color" value={activeFormats.foreColor || '#5b3fa0'} onMouseDown={saveSelection} onChange={handleColorChange} style={{width:'18px',height:'18px',border:'none',padding:0,background:'transparent',cursor:'pointer'}} />
        </label>
        <button onMouseDown={e => { e.preventDefault(); insertPlaceholder('{Student Name}'); }} style={{background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.25)', color: '#60a5fa', cursor: 'pointer', padding: '3px 7px', borderRadius:'4px', fontSize:'0.68rem', fontWeight:700}} title="Insert student name placeholder">Name</button>
        <button onMouseDown={e => { e.preventDefault(); insertPlaceholder('{Batch Number}'); }} style={{background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399', cursor: 'pointer', padding: '3px 7px', borderRadius:'4px', fontSize:'0.68rem', fontWeight:700}} title="Insert batch placeholder">Batch</button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={syncValue}
        onMouseUp={saveSelection}
        onKeyUp={saveSelection}
        onBlur={saveSelection}
        style={{padding: '12px', minHeight: '120px', outline: 'none', color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: 1.6, overflowY: 'auto'}}
      />
    </div>
  );
}

const FIELD_META = {
  studentId:      { label: 'Reg / Student ID', color: '#2563eb', sample: 'BFI10792025' },
  completionDate: { label: 'Date',             color: '#3b82f6', sample: '14/05/2026'  },
  bodyText:       { label: 'Body Text',        color: '#1e293b', sample: null          },
};

const FIELD_DEFAULT_COLORS = {
  studentId: '#2563eb',
  completionDate: '#3b82f6',
  bodyText: '#1e293b',
};

const FONT_SCALE = {
  bodyText: 0.055,
  standard: 0.08,
};

const FIELD_RENDER_ORDER = ['bodyText', 'studentId', 'completionDate'];
const FIELD_LAYER = {
  bodyText: 1,
  studentId: 5,
  completionDate: 5,
};

const DEFAULTS = {
  studentId:      { x: 26,  y: 26,   fontSize: 14, width: 20, height: 6,  fontFamily: 'Times New Roman', fontWeight: 'bold', fontStyle: 'normal', align: 'center', color: FIELD_DEFAULT_COLORS.studentId },
  completionDate: { x: 80,  y: 26,   fontSize: 14, width: 20, height: 6,  fontFamily: 'Times New Roman', fontWeight: 'bold', fontStyle: 'normal', align: 'center', color: FIELD_DEFAULT_COLORS.completionDate },
  bodyText:       { x: 50,  y: 72,   fontSize: 14, width: 72, height: 18, fontFamily: 'Times New Roman', fontWeight: 'normal', fontStyle: 'normal', align: 'center', color: FIELD_DEFAULT_COLORS.bodyText },
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

const fillTemplatePlaceholders = (html, studentName, batchNumber) => {
  const tagOrSpace = '(?:\\s|&nbsp;|<[^>]+>)*';
  const fillRichPlaceholder = (source, firstWord, secondWord, value) => String(source || '')
    .replace(
      new RegExp(`\\{(${tagOrSpace})${firstWord}(${tagOrSpace})${secondWord}(${tagOrSpace})\\}`, 'gi'),
      (_match, before, _between, after) => `${before}${value || ''}${after}`
    );
  return fillRichPlaceholder(
    fillRichPlaceholder(html, 'Student', 'Name', studentName),
    'Batch',
    'Number',
    getOrdinalSuffixHTML(batchNumber)
  );
};

const normalizePositions = (saved = {}) => {
  return FIELD_RENDER_ORDER.reduce((acc, field) => ({
    ...acc,
    [field]: {
      ...DEFAULTS[field],
      ...(saved[field] || {}),
    },
  }), {});
};

export default function CertificateDesigner() {
  const [selectedCourse, setSelectedCourse] = useState(COURSES[0]);
  const [template, setTemplate]   = useState({ layout_json: '{}', background_url: '', course_name: COURSES[0] });
  const [positions, setPositions] = useState(DEFAULTS);
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_BODY);
  const [activeField, setActiveField] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [message, setMessage]   = useState({ text: '', type: '' });

  useEffect(() => { fetchTemplate(selectedCourse); }, [selectedCourse]);

  useEffect(() => {
    const googleFonts = FONTS.filter(f => !['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'].includes(f));
    const linkId = 'cert-google-fonts';
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?' + googleFonts.map(f => `family=${f.replace(/ /g, '+')}`).join('&') + '&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  const fetchTemplate = async (course) => {
    setLoading(true);
    setActiveField(null);
    try {
      const res = await fetch(`${API_BASE}/api/certification/template?courseName=${encodeURIComponent(course)}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTemplate(data);
        try {
          const layout = JSON.parse(data.layout_json || '{}');
          if (layout.positions) setPositions(normalizePositions(layout.positions));
          else setPositions(DEFAULTS);
          if (layout.bodyTemplate) setBodyTemplate(layout.bodyTemplate);
          else setBodyTemplate(DEFAULT_BODY);
        } catch (error) {
          console.error('Failed to parse certificate layout', error);
          setPositions(DEFAULTS);
          setBodyTemplate(DEFAULT_BODY);
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setSaving(true); setMessage({ text: '', type: '' });
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/certification/upload-image`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }, body: fd,
      });
      if (res.ok) { const d = await res.json(); setTemplate(p => ({ ...p, background_url: d.url })); setMessage({ text: 'Uploaded! Save to apply.', type: 'success' }); }
      else { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Upload failed'); }
    } catch (err) { setMessage({ text: `Error: ${err.message}`, type: 'error' }); }
    finally { setSaving(false); e.target.value = ''; }
  };

  const buildPayload = () => ({
    ...template,
    course_name: selectedCourse,
    layout_json: JSON.stringify({ positions, bodyTemplate }),
  });

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true); setMessage({ text: '', type: '' });
    try {
      const res = await fetch(`${API_BASE}/api/certification/template`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(buildPayload()),
      });
      if (res.ok) { setMessage({ text: `Saved for "${selectedCourse}"!`, type: 'success' }); setTimeout(() => setMessage({ text: '', type: '' }), 5000); }
      else throw new Error();
    } catch { setMessage({ text: 'Save failed. Try again.', type: 'error' }); }
    finally { setSaving(false); }
  };

  const handleRemove = async () => {
    if (!window.confirm(`Remove template for "${selectedCourse}"?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/certification/template`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ course_name: selectedCourse, layout_json: '{}', background_url: '' }),
      });
      if (res.ok) { setTemplate({ layout_json: '{}', background_url: '', course_name: selectedCourse }); setPositions(DEFAULTS); setBodyTemplate(DEFAULT_BODY); setActiveField(null); setMessage({ text: 'Template removed.', type: 'success' }); }
    } catch { setMessage({ text: 'Remove failed.', type: 'error' }); }
    finally { setSaving(false); }
  };

  const autoSave = async (pos, body) => {
    try {
      await fetch(`${API_BASE}/api/certification/template`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ ...template, course_name: selectedCourse, layout_json: JSON.stringify({ positions: pos, bodyTemplate: body }) }),
      });
    } catch (error) {
      console.error('Certificate auto-save failed', error);
    }
  };

  const updateFieldStyle = (field, key, value) => {
    setPositions(p => {
      const newPos = { ...p, [field]: { ...p[field], [key]: value } };
      autoSave(newPos, bodyTemplate);
      return newPos;
    });
  };

  const handleDrag = (e, field) => {
    e.preventDefault();
    setActiveField(field);
    const container = e.currentTarget.parentElement;
    const rect = container.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const sp = { ...positions[field] };
    const onMove = (me) => setPositions(p => ({ ...p, [field]: { ...p[field], x: Math.max(0,Math.min(100, sp.x + (me.clientX-sx)/rect.width*100)), y: Math.max(0,Math.min(100, sp.y + (me.clientY-sy)/rect.height*100)) } }));
    const onUp = () => { document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); setPositions(p => { autoSave(p, bodyTemplate); return p; }); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleResize = (e, field, dir) => {
    e.preventDefault(); e.stopPropagation();
    setActiveField(field);
    const cr = document.getElementById('cert-canvas').getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const sw = positions[field].width||20, sh = positions[field].height||6;
    const spx = positions[field].x, spy = positions[field].y;
    const onMove = (me) => {
      const dxP = (me.clientX-sx)/cr.width*100, dyP = (me.clientY-sy)/cr.height*100;
      let [nW,nH,nX,nY]=[sw,sh,spx,spy];
      if(dir.includes('e')){nW=sw+dxP;nX=spx+dxP/2;} if(dir.includes('w')){nW=sw-dxP;nX=spx+dxP/2;}
      if(dir.includes('s')){nH=sh+dyP;nY=spy+dyP/2;} if(dir.includes('n')){nH=sh-dyP;nY=spy+dyP/2;}
      nW=Math.max(4,nW); nH=Math.max(3,nH);
      setPositions(p => ({ ...p, [field]: { ...p[field], x:Math.max(0,Math.min(100,nX)), y:Math.max(0,Math.min(100,nY)), width:nW, height:nH } }));
    };
    const onUp = () => { document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); setPositions(p => { autoSave(p, bodyTemplate); return p; }); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const renderHandles = (field) => {
    if (activeField !== field) return null;
    const c = FIELD_META[field].color;
    return [
      {d:'nw',s:{top:'-5px',left:'-5px',cursor:'nwse-resize'}},{d:'ne',s:{top:'-5px',right:'-5px',cursor:'nesw-resize'}},
      {d:'sw',s:{bottom:'-5px',left:'-5px',cursor:'nesw-resize'}},{d:'se',s:{bottom:'-5px',right:'-5px',cursor:'nwse-resize'}},
      {d:'n',s:{top:'-5px',left:'50%',transform:'translateX(-50%)',cursor:'ns-resize'}},
      {d:'s',s:{bottom:'-5px',left:'50%',transform:'translateX(-50%)',cursor:'ns-resize'}},
      {d:'w',s:{left:'-5px',top:'50%',transform:'translateY(-50%)',cursor:'ew-resize'}},
      {d:'e',s:{right:'-5px',top:'50%',transform:'translateY(-50%)',cursor:'ew-resize'}},
    ].map((h,i)=>(
      <div key={i} onMouseDown={(e)=>handleResize(e,field,h.d)}
        style={{position:'absolute',width:'9px',height:'9px',background:c,border:'2px solid #fff',borderRadius:h.d.length===1?'2px':'50%',zIndex:40,...h.s}} />
    ));
  };

  const renderBodyPreview = () => {
    return <div dangerouslySetInnerHTML={{ __html: fillTemplatePlaceholders(bodyTemplate, PREVIEW_STUDENT_NAME, PREVIEW_BATCH_NUMBER) }} />;
  };

  const mapFont = (f) => f ? `"${f}", sans-serif` : 'sans-serif';

  const panelCard = (children, extra={}) => (
    <div className="glass-panel" style={{padding:'1.25rem',...extra}}>{children}</div>
  );
  const sectionLabel = (text) => (
    <p style={{fontSize:'0.68rem',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--text-muted)',marginBottom:'0.75rem'}}>{text}</p>
  );

  return (
    <div className="page-container container" onClick={() => setActiveField(null)}>
      {/* Header */}
      <div style={{marginBottom:'2rem',display:'flex',alignItems:'center',gap:'0.75rem'}}>
        <div style={{width:'44px',height:'44px',borderRadius:'12px',background:'linear-gradient(135deg,var(--accent-primary),var(--accent-secondary))',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 4px 14px rgba(37,99,235,0.4)'}}>
          <Award size={22} color="#fff"/>
        </div>
        <div>
          <h1 className="text-gradient" style={{fontSize:'2rem',lineHeight:1}}>Certificate Designer</h1>
          <p style={{fontSize:'0.82rem',color:'var(--text-muted)',marginTop:'2px'}}>Upload templates &amp; configure dynamic text fields per course</p>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'340px 340px 1fr',gap:'1.25rem',alignItems:'start'}} onClick={e => e.stopPropagation()}>
        {/* ── COLUMN 1: GENERAL & CANVAS FIELDS ── */}
        <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
          {/* Course select */}
          {panelCard(<>
            {sectionLabel('Select Course')}
            <div style={{position:'relative'}}>
              <select className="input-glass" value={selectedCourse} onChange={e=>setSelectedCourse(e.target.value)} style={{width:'100%',cursor:'pointer',paddingRight:'2.5rem',appearance:'none',fontWeight:600}}>
                {COURSES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown size={15} style={{position:'absolute',right:'0.75rem',top:'50%',transform:'translateY(-50%)',color:'var(--text-muted)',pointerEvents:'none'}}/>
            </div>
          </>)}

          {/* Template image */}
          {panelCard(<>
            {sectionLabel('Certificate Image')}
            {template.background_url
              ? <img src={template.background_url} alt="template" style={{width:'100%',aspectRatio:'1.414',objectFit:'cover',borderRadius:'8px',border:'1px solid var(--glass-border)',marginBottom:'0.75rem'}}/>
              : <div style={{border:'2px dashed var(--glass-border)',borderRadius:'8px',padding:'1.5rem',display:'flex',flexDirection:'column',alignItems:'center',gap:'0.4rem',marginBottom:'0.75rem',color:'var(--text-muted)'}}>
                  <ImageIcon size={28} style={{opacity:0.35}}/><span style={{fontSize:'0.8rem'}}>No template</span>
                </div>
            }
            <label style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'0.5rem',padding:'0.6rem',borderRadius:'8px',cursor:saving?'not-allowed':'pointer',background:'rgba(37,99,235,0.1)',border:'1px solid rgba(37,99,235,0.3)',color:'var(--accent-primary)',fontWeight:600,fontSize:'0.82rem',width:'100%'}}>
              <UploadCloud size={15}/>{saving?'Uploading…':'Upload New Template'}
              <input type="file" accept="image/*" style={{display:'none'}} onChange={handleFileUpload} disabled={saving}/>
            </label>
          </>)}

          {/* Field legend & Properties */}
          {panelCard(<>
            {sectionLabel('Canvas Fields')}
            <p style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'0.6rem',lineHeight:1.5}}>
              Click a field to select it and change its styles.
            </p>
            <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
              {FIELD_RENDER_ORDER.filter(k => k !== 'bodyText').map(k => {
                const m = FIELD_META[k];
                return (
                <div key={k}
                  onClick={() => setActiveField(k)}
                  style={{
                    display:'flex',alignItems:'center',gap:'0.6rem',padding:'0.5rem 0.75rem',borderRadius:'7px',
                    background: activeField === k ? `${m.color}22` : `${m.color}12`,
                    border:`1px solid ${activeField === k ? m.color : m.color+'30'}`,
                    cursor: 'pointer'
                  }}>
                  <Move size={13} style={{color:m.color}}/>
                  <span style={{fontSize:'0.82rem',fontWeight:700,color:m.color,flex:1}}>{m.label}</span>
                </div>
              )})}
            </div>

            {activeField && activeField !== 'bodyText' && (
              <div style={{marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
                {sectionLabel(`${FIELD_META[activeField].label} Styles`)}

                {/* Font Family */}
                <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                  <Type size={14} style={{color:'var(--text-muted)'}}/>
                  <select
                    className="input-glass"
                    value={positions[activeField]?.fontFamily || 'Times New Roman'}
                    onChange={e => updateFieldStyle(activeField, 'fontFamily', e.target.value)}
                    style={{flex: 1, padding: '0.4rem', fontSize: '0.8rem', height:'32px'}}
                  >
                    {FONTS.map(f => <option key={f} value={f} style={{fontFamily: f}}>{f}</option>)}
                  </select>
                </div>

                <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between'}}>
                  {/* Font Size */}
                  <div style={{display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', border: '1px solid var(--glass-border)'}}>
                    <button onClick={() => updateFieldStyle(activeField, 'fontSize', Math.max(8, (positions[activeField]?.fontSize || 14) - 1))} style={{background: 'none', border: 'none', color: 'var(--text-primary)', padding: '4px', cursor: 'pointer', display:'flex'}}><Minus size={14}/></button>
                    <span style={{width: '30px', textAlign: 'center', fontSize: '0.8rem', fontWeight:600}}>{Math.round(positions[activeField]?.fontSize || 14)}</span>
                    <button onClick={() => updateFieldStyle(activeField, 'fontSize', Math.min(72, (positions[activeField]?.fontSize || 14) + 1))} style={{background: 'none', border: 'none', color: 'var(--text-primary)', padding: '4px', cursor: 'pointer', display:'flex'}}><Plus size={14}/></button>
                  </div>

                  {/* Weight & Style */}
                  <div style={{display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', border: '1px solid var(--glass-border)', overflow: 'hidden'}}>
                    <button
                      onClick={() => updateFieldStyle(activeField, 'fontWeight', positions[activeField]?.fontWeight === 'bold' ? 'normal' : 'bold')}
                      style={{background: positions[activeField]?.fontWeight === 'bold' ? 'var(--accent-primary)' : 'none', border: 'none', color: positions[activeField]?.fontWeight === 'bold' ? '#fff' : 'var(--text-primary)', padding: '6px 8px', cursor: 'pointer', display:'flex'}}
                    ><Bold size={14}/></button>
                    <button
                      onClick={() => updateFieldStyle(activeField, 'fontStyle', positions[activeField]?.fontStyle === 'italic' ? 'normal' : 'italic')}
                      style={{background: positions[activeField]?.fontStyle === 'italic' ? 'var(--accent-primary)' : 'none', border: 'none', borderLeft: '1px solid var(--glass-border)', color: positions[activeField]?.fontStyle === 'italic' ? '#fff' : 'var(--text-primary)', padding: '6px 8px', cursor: 'pointer', display:'flex'}}
                    ><Italic size={14}/></button>
                  </div>

                  {/* Alignment */}
                  <div style={{display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', border: '1px solid var(--glass-border)', overflow: 'hidden'}}>
                    {['left', 'center', 'right', 'justify'].map(align => {
                      const Icon = align === 'left' ? AlignLeft : align === 'center' ? AlignCenter : align === 'right' ? AlignRight : AlignJustify;
                      const currentAlign = positions[activeField]?.align || 'center';
                      return (
                        <button
                          key={align}
                          onClick={() => updateFieldStyle(activeField, 'align', align)}
                          style={{background: currentAlign === align ? 'var(--accent-primary)' : 'none', border: 'none', borderLeft: align !== 'left' ? '1px solid var(--glass-border)' : 'none', color: currentAlign === align ? '#fff' : 'var(--text-primary)', padding: '6px 8px', cursor: 'pointer', display:'flex'}}
                        ><Icon size={14}/></button>
                      )
                    })}
                  </div>
                </div>

                <label style={{display:'flex',alignItems:'center',gap:'0.5rem',fontSize:'0.78rem',fontWeight:700,color:'var(--text-muted)'}}>
                  <Palette size={14}/>
                  <span style={{minWidth:'68px'}}>Text Color</span>
                  <input
                    type="color"
                    value={positions[activeField]?.color || FIELD_DEFAULT_COLORS[activeField]}
                    onChange={e => updateFieldStyle(activeField, 'color', e.target.value)}
                    style={{width:'42px',height:'28px',border:'1px solid var(--glass-border)',borderRadius:'6px',background:'transparent',cursor:'pointer'}}
                  />
                </label>
              </div>
            )}
          </>)}
        </div>

        {/* ── COLUMN 2: BODY TEXT & ACTIONS ── */}
        <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
          {/* Body text editor */}
          {panelCard(<>
            {sectionLabel('Body Paragraph Text')}
            <p style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'0.6rem',lineHeight:1.5}}>
              Use <strong style={{color:'#2563eb'}}>{'{Student Name}'}</strong> and <strong style={{color:'#10b981'}}>{'{Batch Number}'}</strong> as placeholders.
              The canvas preview fills them with sample data so line breaks match generated certificates more closely.
            </p>
            <RichTextEditor
              value={bodyTemplate}
              onChange={(val) => { setBodyTemplate(val); autoSave(positions, val); }}
            />
          </>)}

          {/* Message */}
          {message.text && (
            <div style={{padding:'0.75rem',borderRadius:'9px',display:'flex',alignItems:'center',gap:'0.5rem',background:message.type==='error'?'rgba(239,68,68,0.1)':'rgba(16,185,129,0.1)',border:`1px solid ${message.type==='error'?'rgba(239,68,68,0.3)':'rgba(16,185,129,0.3)'}`,color:message.type==='error'?'#f87171':'#34d399',fontSize:'0.82rem'}}>
              <CheckCircle2 size={14}/>{message.text}
            </div>
          )}

          {/* Save */}
          <button onClick={handleSave} disabled={saving||loading} style={{width:'100%',padding:'0.8rem',borderRadius:'9px',border:'none',cursor:saving||loading?'not-allowed':'pointer',background:saving||loading?'rgba(37,99,235,0.4)':'linear-gradient(135deg,var(--accent-primary),#1d4ed8)',color:'#fff',fontWeight:700,fontSize:'0.88rem',display:'flex',alignItems:'center',justifyContent:'center',gap:'0.5rem',boxShadow:saving||loading?'none':'0 4px 14px rgba(37,99,235,0.4)'}}>
            <Save size={16}/>{saving?'Saving…':'Save Template'}
          </button>
          {template.background_url && (
            <button onClick={handleRemove} disabled={saving} style={{width:'100%',padding:'0.65rem',borderRadius:'9px',background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.25)',color:'#f87171',fontWeight:600,fontSize:'0.82rem',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:'0.5rem'}}>
              <Trash2 size={14}/>Remove Template
            </button>
          )}
        </div>

        {/* ── RIGHT: CANVAS ── */}
        <div className="glass-panel" style={{padding:'1.25rem'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'0.75rem'}}>
            <div>
              <p style={{fontSize:'0.68rem',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--text-muted)'}}>Live Preview</p>
              <p style={{fontSize:'0.95rem',fontWeight:700,color:'var(--accent-primary)',marginTop:'1px'}}>{selectedCourse}</p>
            </div>
            <div style={{padding:'0.3rem 0.7rem',borderRadius:'20px',fontSize:'0.7rem',fontWeight:600,background:template.background_url?'rgba(16,185,129,0.12)':'rgba(255,255,255,0.04)',border:`1px solid ${template.background_url?'rgba(16,185,129,0.3)':'var(--glass-border)'}`,color:template.background_url?'#34d399':'var(--text-muted)',display:'flex',alignItems:'center',gap:'0.35rem'}}>
              <span style={{width:'6px',height:'6px',borderRadius:'50%',background:template.background_url?'#34d399':'var(--text-muted)',display:'inline-block'}}/>
              {template.background_url?'Template loaded':'No template'}
            </div>
          </div>
          <div style={{height:'1px',background:'var(--glass-border)',marginBottom:'1rem'}}/>

          {/* Canvas */}
          <div id="cert-canvas" style={{width:'100%',aspectRatio:'1.414',background:template.background_url?`url(${template.background_url}) center/cover no-repeat, white`:'linear-gradient(135deg,#1a1624,#0c0b0f)',borderRadius:'10px',border:template.background_url?'1px solid var(--glass-border)':'2px dashed var(--glass-border)',position:'relative',overflow:'hidden',boxShadow:'0 16px 48px rgba(0,0,0,0.4)',opacity:loading?0.5:1,transition:'opacity 0.3s',containerType:'inline-size'}}>

            {!template.background_url && (
              <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'0.6rem',color:'var(--text-muted)'}}>
                <ImageIcon size={36} style={{opacity:0.3}}/><p style={{fontSize:'0.82rem'}}>Upload a certificate template to begin</p>
              </div>
            )}

            {template.background_url && FIELD_RENDER_ORDER.map(field => {
              const meta = FIELD_META[field];
              const pos = positions[field] || DEFAULTS[field];
              const isBody = field === 'bodyText';
              const isActive = activeField === field;

              const fieldStyle = {
                fontFamily: mapFont(pos.fontFamily || 'times'),
                fontWeight: pos.fontWeight === 'bold' ? 700 : 400,
                fontStyle: pos.fontStyle || 'normal',
                textAlign: pos.align || 'center',
                color: pos.color || FIELD_DEFAULT_COLORS[field] || meta.color
              };

              return (
                <div key={field} onMouseDown={(e)=>handleDrag(e,field)} title={`Drag: ${meta.label}`}
                  style={{position:'absolute',top:`${pos.y}%`,left:`${pos.x}%`,width:`${pos.width||20}%`,height:`${pos.height||6}%`,
                    transform:'translate(-50%,-50%)',display:'flex',
                    flexDirection: isBody ? 'column' : 'row',
                    alignItems: isBody ? 'stretch' : 'center',
                    justifyContent: isBody ? 'flex-start' : (pos.align === 'left' ? 'flex-start' : pos.align === 'right' ? 'flex-end' : 'center'),
                    cursor:'move',
                    background: isActive ? `${meta.color}22` : 'transparent',
                    border: isActive ? `2px solid ${meta.color}` : `1px dashed ${meta.color}80`,
                    borderRadius:'5px',
                    userSelect:'none',
                    boxShadow: isActive ? `0 2px 12px ${meta.color}35` : 'none',
                    backdropFilter: isActive ? 'blur(2px)' : 'none',
                    padding:isBody?'0.36cqw 0.54cqw':'0',overflow:'hidden',
                    zIndex: isActive ? 30 : FIELD_LAYER[field],
                  }}>
                  {isBody ? (
                    <div style={{width:'100%',fontSize:`${(pos.fontSize||14)*FONT_SCALE.bodyText}cqw`,lineHeight:1.5,wordBreak:'break-word',pointerEvents:'none', ...fieldStyle}}>
                      {renderBodyPreview()}
                    </div>
                  ) : (
                    <span style={{whiteSpace:'nowrap',fontSize:`${(pos.fontSize||14)*FONT_SCALE.standard}cqw`, ...fieldStyle}}>
                      {meta.sample}
                    </span>
                  )}
                  {renderHandles(field)}
                </div>
              );
            })}
          </div>

          {template.background_url && (
            <p style={{fontSize:'0.72rem',color:'var(--text-muted)',marginTop:'0.65rem',textAlign:'center'}}>
              Drag boxes to position • Resize with corner/edge handles • <strong style={{color:'var(--accent-primary)'}}>Body text wraps automatically</strong>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
