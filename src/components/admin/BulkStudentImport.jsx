import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { UploadCloud, CheckCircle2, FileSpreadsheet, X, AlertCircle, History, Download, Clapperboard, Film, FileText } from 'lucide-react';
import { getOrdinalSuffix } from '../../utils/formatUtils';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export default function BulkStudentImport({ onImportComplete }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  const [file, setFile] = useState(null);
  const [previewData, setPreviewData] = useState([]);
  const [batchNumber, setBatchNumber] = useState('');
  const [courses, setCourses] = useState(['Online Filmmaking Course']);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [results, setResults] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/admin/imports/history', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleDownloadOldResults = async (id, batchNumber) => {
    try {
      const res = await fetch(`/api/admin/imports/history/${id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!res.ok) return;
      const historyResults = await res.json();
      
      const finalData = historyResults.map(r => {
        const row = { ...r.originalRow };
        if (r.status === 'success') {
          row['Credentials'] = `Username: ${r.username} \nPassword: ${r.password} \nStudent ID: ${r.studentId}`;
        } else {
          row['Credentials'] = `ERROR: ${r.error}`;
        }
        return row;
      });

      const newWb = XLSX.utils.book_new();
      const newWs = XLSX.utils.json_to_sheet(finalData);
      XLSX.utils.book_append_sheet(newWb, newWs, "Import Results");
      XLSX.writeFile(newWb, `BFI_Students_Import_Batch_${batchNumber || 'History'}.xlsx`);
    } catch (err) {
      console.error(err);
    }
  };

  const availableCourses = [
    { name: 'Online Filmmaking Course', type: 'filmmaking' },
    { name: 'Film Appreciation Course', type: 'workshop' },
    { name: 'Script Writing', type: 'workshop' },
    { name: 'Cinematography', type: 'workshop' },
    { name: 'Acting', type: 'workshop' }
  ];

  const handleCourseChange = (courseName) => {
    if (courses.includes(courseName)) {
      setCourses(courses.filter(c => c !== courseName));
    } else {
      setCourses([...courses, courseName]);
    }
  };

  const handleFileUpload = (e) => {
    setErrorMsg('');
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;
    setFile(uploadedFile);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      let data2D = [];
      const fileExt = uploadedFile.name.split('.').pop().toLowerCase();

      try {
        if (fileExt === 'docx' || fileExt === 'doc') {
          const result = await mammoth.convertToHtml({ arrayBuffer: evt.target.result });
          const parser = new DOMParser();
          const doc = parser.parseFromString(result.value, 'text/html');
          const tables = doc.querySelectorAll('table');
          tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
              const cols = Array.from(row.querySelectorAll('th, td')).map(td => td.innerText.trim());
              data2D.push(cols);
            });
          });
          // Fallback if no tables but there are paragraphs
          if (data2D.length === 0) {
             const paragraphs = doc.querySelectorAll('p');
             paragraphs.forEach(p => {
               const text = p.innerText.trim();
               if (text) {
                 // Split by tabs, multiple spaces, pipes, or commas
                 data2D.push(text.split(/\s{2,}|\t|\||,/));
               }
             });
          }
        } else if (fileExt === 'pdf') {
          const loadingTask = pdfjsLib.getDocument(new Uint8Array(evt.target.result));
          const pdf = await loadingTask.promise;
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            
            const rowsMap = new Map();
            content.items.forEach(item => {
              const y = Math.round(item.transform[5] / 5) * 5; // Group items within 5 pixels vertically
              if (!rowsMap.has(y)) rowsMap.set(y, []);
              rowsMap.get(y).push(item);
            });
            
            const sortedY = Array.from(rowsMap.keys()).sort((a, b) => b - a);
            sortedY.forEach(y => {
              const rowItems = rowsMap.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
              const rowStrings = rowItems.map(item => item.str.trim()).filter(Boolean);
              if (rowStrings.length > 0) data2D.push(rowStrings);
            });
          }
        } else {
          // Default to XLSX / CSV
          const bstr = new Uint8Array(evt.target.result);
          const wb = XLSX.read(bstr, { type: 'array' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          data2D = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        }
      } catch (parseErr) {
        console.error("Parse error:", parseErr);
        setErrorMsg("Failed to parse file. Please ensure it's a valid Excel, Word, or PDF document.");
        setPreviewData([]);
        return;
      }

      // =========================================================
      // UNIVERSAL SMART CELL SCANNER helpers
      // =========================================================
      const extractEmailsFromText = (text) => {
        if (!text) return [];
        return [...text.matchAll(/([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6})/g)].map(m => m[1]);
      };

      const extractPhonesFromText = (text) => {
        if (!text) return [];
        const phones = [];
        // BD mobile: starts with +880, 880, or 0, then 1[3-9], then 8 digits
        const bdMatches = [...text.matchAll(/(?:\+?880|0)[1][3-9]\d{8}/g)];
        for (const m of bdMatches) phones.push(m[0]);
        if (phones.length > 0) return phones;
        // 10-digit starting with 1 (Excel dropped leading zero)
        const tenDigit = [...text.matchAll(/\b1[3-9]\d{8}\b/g)];
        for (const m of tenDigit) phones.push('0' + m[0]);
        if (phones.length > 0) return phones;
        // Any 7–11 digit number (landline fallback)
        const anyPhone = [...text.matchAll(/\b\d{7,11}\b/g)];
        for (const m of anyPhone) phones.push(m[0]);
        return phones;
      };

      const looksLikeName = (val) => {
        if (!val || val.length < 3 || val.length > 100) return false;
        if (/^\d/.test(val)) return false;
        if (/@/.test(val)) return false;
        if (/\d{5,}/.test(val)) return false;
        if (/^\d+(?:st|nd|rd|th)$/i.test(val.trim())) return false;
        const words = val.trim().split(/\s+/);
        if (words.length < 2 || words.length > 6) return false;
        return words.every(w => /^[A-Za-z\u0080-\uFFFF][a-zA-Z\u0080-\uFFFF.'()\-]{0,30}$/.test(w));
      };

      const looksLikeAddress = (val) => {
        if (!val || val.length < 8) return false;
        return /(?:house|road|street|block|sector|flat|floor|village|district|dhaka|chittagong|sylhet|rajshahi|khulna|mohammadpur|mirpur|gulshan|banani|dhanmondi|uttara|motijheel|paltan|wari|lalbagh|old dhaka|new dhaka|azimpur|rayer|bazar|para|thana|upazila|union|gram|#|avenue)/i.test(val);
      };

      const normalizeBatch = (val) => {
        if (!val) return '';
        // "1st" → "1", "2nd" → "2", "3rd" → "3" etc.
        const m = val.trim().match(/^(\d+)(?:st|nd|rd|th)?$/i);
        return m ? m[1] : val;
      };

      // =========================================================
      // PASS 1: Pre-scan ALL rows for metadata (batch, year, course)
      // =========================================================
      let detectedBatch = '';
      let detectedYear = '';
      let detectedCourse = '';

      for (const row of data2D) {
        if (!row || !Array.isArray(row)) continue;
        const rowText = row.map(c => c || '').join(' ');

        if (!detectedBatch) {
          // e.g. "1st Film Appreciation Course", "2nd Batch", "3rd Filmmaking"
          const bm = rowText.match(/(\d+)(?:st|nd|rd|th)?\s*(?:batch|film\s+appreciation|filmmaking|script|cinematography|acting|course|workshop)/i);
          if (bm) detectedBatch = bm[1];
        }
        if (!detectedYear) {
          const ym = rowText.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
          if (ym) detectedYear = ym[1];
        }
        if (!detectedCourse) {
          const cm = rowText.match(/(Film\s+Appreciation\s+Course|Online\s+Filmmaking\s+Course|Script\s+Writing|Cinematography\s+Course|Acting\s+Course|Filmmaking\s+Course)/i);
          if (cm) detectedCourse = cm[1];
        }
      }

      // =========================================================
      // PASS 2: Header row detection (enhanced)
      // =========================================================
      let headerRowIdx = -1;
      let headerMap = {};

      for (let i = 0; i < data2D.length; i++) {
        const row = data2D[i];
        if (!row || !Array.isArray(row)) continue;

        let foundName = -1, foundEmail = -1, foundMobile = -1, foundAddress = -1;
        let foundSN = -1, foundYear = -1, foundBatch = -1;
        let foundGender = -1, foundBirthday = -1, foundProfession = -1;
        let foundEducation = -1, foundWhatsapp = -1, foundPermanentAddress = -1;

        for (let j = 0; j < row.length; j++) {
          if (!row[j] || typeof row[j] !== 'string') continue;
          const val = row[j].toLowerCase().trim();

          if (val.includes('name') || val === 'student') foundName = j;
          if (val.includes('mail')) foundEmail = j;
          if (val.includes('mobile') || val.includes('phone') || val.includes('contact') || val.includes('telephone')) foundMobile = j;
          if (val.includes('whatsapp')) foundWhatsapp = j;

          if (val.includes('permanent address')) foundPermanentAddress = j;
          else if (val.includes('present address') || val.includes('current address')) foundAddress = j;
          else if ((val.includes('address') || val.includes('city') || val.includes('location')) && foundAddress === -1) foundAddress = j;

          if (['sn', 'sl', 'sl.', 'no', 's/n', 'n.o.'].includes(val) || val.startsWith('sl.') || val.includes('serial') || val.includes('sl. no')) foundSN = j;
          if (val.includes('year') || val === 'yr') foundYear = j;
          if (val.includes('batch')) foundBatch = j;

          if (val === 'gender' || val === 'sex') foundGender = j;
          if (val.includes('birth') || val === 'dob') foundBirthday = j;
          if (val.includes('profession') || val.includes('occupation') || val === 'job') foundProfession = j;
          if (val.includes('education') || val.includes('qualification') || val.includes('degree')) foundEducation = j;
        }

        // Accept as header if Name + (contact OR address OR batch)
        const hasContact = foundMobile !== -1 || foundEmail !== -1;
        const hasEnoughContext = foundName !== -1 && (hasContact || foundAddress !== -1 || foundBatch !== -1);

        if (hasEnoughContext) {
          headerRowIdx = i;
          headerMap = {
            sn: foundSN, name: foundName, address: foundAddress, permanentAddress: foundPermanentAddress,
            mobile: foundMobile, whatsapp: foundWhatsapp, email: foundEmail, year: foundYear, batch: foundBatch,
            gender: foundGender, birthday: foundBirthday, profession: foundProfession, education: foundEducation
          };
          break;
        }
      }

      // =========================================================
      // Smart per-row scanner: scans ALL cells and fills any missing field
      // =========================================================
      const smartScanRow = (row, base) => {
        let { name, email, mobile, address, batch } = base;
        const assignedCols = Object.values(headerMap).filter(v => v !== -1 && v !== undefined);

        for (let j = 0; j < row.length; j++) {
          const cellRaw = row[j] ? String(row[j]).trim() : '';
          if (!cellRaw) continue;

          if (assignedCols.includes(j)) {
            // Still check phone column for embedded email
            if (j === headerMap.mobile && !email) {
              const em = extractEmailsFromText(cellRaw);
              if (em.length > 0) email = em[0];
            }
            continue;
          }

          if (!email) {
            const em = extractEmailsFromText(cellRaw);
            if (em.length > 0) { email = em[0]; continue; }
          }
          if (!mobile) {
            const ph = extractPhonesFromText(cellRaw.replace(/@[\w.]+/g, ''));
            if (ph.length > 0) { mobile = ph[0]; continue; }
          }
          if (!batch) {
            const ordM = cellRaw.match(/^(\d+)(?:st|nd|rd|th)$/i);
            if (ordM) { batch = ordM[1]; continue; }
          }
          if (!name && looksLikeName(cellRaw)) { name = cellRaw; continue; }
          if (!address && looksLikeAddress(cellRaw)) { address = cellRaw; continue; }
        }

        return { name, email, mobile, address, batch };
      };

      // =========================================================
      // Header-based parsing + smart augmentation per row
      // =========================================================
      const parseWithHeader = (row, rowIndex) => {
        const hv = (key) => {
          const col = headerMap[key];
          return (col !== undefined && col !== -1 && row[col]) ? String(row[col]).trim() : '';
        };

        let name = hv('name');
        let email = hv('email');
        let rawMobile = hv('mobile');
        let address = hv('address');
        const permanentAddress = hv('permanentAddress');
        const gender     = hv('gender');
        const birthday   = hv('birthday');
        const profession = hv('profession');
        const education  = hv('education');
        const whatsapp   = hv('whatsapp');
        const snNo       = hv('sn') || String(rowIndex + 1);
        const year       = hv('year') || detectedYear || new Date().getFullYear().toString();

        // Batch column: normalize ordinals (1st → 1, 2nd → 2 ...)
        let batch = normalizeBatch(hv('batch')) || detectedBatch || '';

        // Extract email embedded inside any of phone / address / name fields
        for (const field of [rawMobile, address, name]) {
          if (!email && field) {
            const em = extractEmailsFromText(field);
            if (em.length > 0) email = em[0];
          }
        }

        // Clean rawMobile: strip any embedded email, then extract a clean phone
        let mobile = '';
        if (rawMobile) {
          const embedded = extractEmailsFromText(rawMobile);
          if (embedded.length > 0) {
            if (!email) email = embedded[0];
            rawMobile = rawMobile.replace(embedded[0], '').trim();
          }
          // Strip label artefacts like "Phone :" that appear in some cells
          rawMobile = rawMobile.replace(/\bPhone\s*:?\s*/gi, '').trim();
          const phones = extractPhonesFromText(rawMobile);
          mobile = phones.length > 0 ? phones[0] : '';
          if (!mobile && rawMobile.replace(/\D/g, '').length >= 7) {
            mobile = rawMobile.replace(/[^\d+]/g, '');
          }
        }

        // Smart augmentation: fill any still-missing fields from unassigned cells
        const aug = smartScanRow(row, { name, email, mobile, address, batch });
        name    = aug.name    || name;
        email   = aug.email   || email;
        mobile  = aug.mobile  || mobile;
        address = aug.address || address;
        batch   = aug.batch   || batch || detectedBatch || '';

        return { snNo, year, batch, name, address, permanentAddress, gender, birthday, profession, education, whatsapp, mobile, email, originalRow: row };
      };

      // =========================================================
      // Fully headerless: Universal cell-scanner (last resort)
      // =========================================================
      const parseWithoutHeader = (row, rowIndex) => {
        let name = '', email = '', mobile = '', address = '';
        let batch = detectedBatch || '';
        let year  = detectedYear  || new Date().getFullYear().toString();

        for (let j = 0; j < row.length; j++) {
          const cellRaw = row[j] ? String(row[j]).trim() : '';
          if (!cellRaw) continue;

          // Email
          if (!email) {
            const em = extractEmailsFromText(cellRaw);
            if (em.length > 0) { email = em[0]; }
          }
          // Phone (strip email chars first)
          if (!mobile) {
            const cleaned = cellRaw.replace(/[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g, '');
            const ph = extractPhonesFromText(cleaned);
            if (ph.length > 0) mobile = ph[0];
          }
          // Batch ordinal: 1st, 2nd, 3rd, 4th …
          if (!batch) {
            const ordM = cellRaw.match(/^(\d+)(?:st|nd|rd|th)$/i);
            if (ordM) { batch = ordM[1]; continue; }
          }
          // Year
          if (!year || year === new Date().getFullYear().toString()) {
            const ym = cellRaw.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
            if (ym) year = ym[1];
          }
          if (!name && looksLikeName(cellRaw)) name = cellRaw;
          if (!address && looksLikeAddress(cellRaw)) address = cellRaw;
        }

        return { snNo: String(rowIndex + 1), year, batch, name, address, permanentAddress: '', gender: '', birthday: '', profession: '', education: '', whatsapp: '', mobile, email, originalRow: row };
      };

      // =========================================================
      // BUILD FINAL mappedData
      // =========================================================
      const mappedData = [];

      if (headerRowIdx !== -1) {
        for (let i = headerRowIdx + 1; i < data2D.length; i++) {
          const row = data2D[i];
          if (!row || !Array.isArray(row) || row.every(c => !c)) continue;
          const parsed = parseWithHeader(row, mappedData.length);
          if (!parsed.name && !parsed.email && !parsed.mobile) continue;
          mappedData.push(parsed);
        }
      } else {
        // Fully headerless: scan every row
        for (let i = 0; i < data2D.length; i++) {
          const row = data2D[i];
          if (!row || !Array.isArray(row) || row.every(c => !c)) continue;
          const parsed = parseWithoutHeader(row, mappedData.length);
          if (!parsed.name && !parsed.email && !parsed.mobile) continue;
          if (!parsed.email && !parsed.mobile && !looksLikeName(parsed.name)) continue;
          mappedData.push(parsed);
        }
      }

      if (detectedBatch) setBatchNumber(detectedBatch);

      // Auto-select the detected course from document title
      if (detectedCourse) {
        const lc = detectedCourse.toLowerCase();
        if (lc.includes('appreciation'))        setCourses(['Film Appreciation Course']);
        else if (lc.includes('filmmaking') || lc.includes('film')) setCourses(['Online Filmmaking Course']);
        else if (lc.includes('script'))         setCourses(['Script Writing']);
        else if (lc.includes('cinematography')) setCourses(['Cinematography']);
        else if (lc.includes('acting'))         setCourses(['Acting']);
      }

      setPreviewData(mappedData);
    };
    reader.readAsArrayBuffer(uploadedFile);
  };

  const handleImport = async () => {
    if (previewData.length === 0) return;
    setIsProcessing(true);
    setProcessedCount(0);
    setResults(null);
    setErrorMsg('');

    try {
      const allResults = [];
      for (let i = 0; i < previewData.length; i++) {
        const student = previewData[i];
        try {
          const res = await fetch('/api/admin/students/bulk?saveHistory=false', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
              students: [student],
              batchNumber,
              courses
            })
          });

          const data = await res.json();
          if (res.ok && data.results && data.results.length > 0) {
            allResults.push(data.results[0]);
          } else {
            allResults.push({ ...student, status: 'error', error: data.error || 'Failed to import student' });
          }
        } catch {
          allResults.push({ ...student, status: 'error', error: 'Network error' });
        }
        setProcessedCount(i + 1);
      }

      // Save history after all students are processed
      await fetch('/api/admin/imports/save-history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          batchNumber,
          results: allResults
        })
      });

      setResults(allResults);
      if (onImportComplete) onImportComplete();
      
    } catch (err) {
      console.error(err);
      setErrorMsg('An error occurred during the import process.');
    } finally {
      setIsProcessing(false);
      setProcessedCount(0);
    }
  };

  const handleDownloadResults = () => {
    if (!results) return;

    // We merge the results back into the original row format
    const finalData = results.map(r => {
      const row = { ...r.originalRow };
      if (r.status === 'success') {
        row['Credentials'] = `Username: ${r.username} \nPassword: ${r.password} \nStudent ID: ${r.studentId}`;
      } else {
        row['Credentials'] = `ERROR: ${r.error}`;
      }
      return row;
    });

    const newWb = XLSX.utils.book_new();
    const newWs = XLSX.utils.json_to_sheet(finalData);
    XLSX.utils.book_append_sheet(newWb, newWs, "Import Results");
    XLSX.writeFile(newWb, `BFI_Students_Import_Batch_${batchNumber || 'New'}.xlsx`);
  };

  const closeModal = () => {
    setIsOpen(false);
    setFile(null);
    setPreviewData([]);
    setBatchNumber('');
    setCourses(['Online Filmmaking Course']);
    setResults(null);
    setErrorMsg('');
  };

  return (
    <>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <button 
          onClick={() => setIsOpen(true)}
          className="modern-btn modern-btn--primary hover-scale"
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.75rem'
          }}
        >
          <FileSpreadsheet size={20} strokeWidth={2.5} />
          <span>Smart Batch Import</span>
        </button>

        <button
          onClick={() => { setIsHistoryOpen(true); fetchHistory(); }}
          className="modern-btn modern-btn--secondary hover-scale"
          style={{
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.75rem'
          }}
        >
          <History size={20} strokeWidth={2.5} />
          <span>History</span>
        </button>
      </div>

      {isOpen && createPortal(
        <div className="modern-modal-overlay" onClick={closeModal}>
          <style>
            {`
              /* Modal Visibility Improvements - Blue Theme */
              .bulk-import-modal { background: #0f172a !important; border: 1px solid rgba(14, 165, 233, 0.2) !important; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(14, 165, 233, 0.15) !important; }
              .bulk-import-dropzone { background: rgba(14, 165, 233, 0.03) !important; border: 2px dashed rgba(14, 165, 233, 0.3) !important; }
              .bulk-import-dropzone:hover { background: rgba(14, 165, 233, 0.08) !important; border-color: rgba(14, 165, 233, 0.6) !important; }
              .bulk-import-icon-bg { background: rgba(14, 165, 233, 0.15) !important; border: 1px solid rgba(14, 165, 233, 0.3) !important; color: #38bdf8 !important; }

              [data-mode="light"] .bulk-import-modal { background: #ffffff !important; border: 1px solid rgba(14, 165, 233, 0.2) !important; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15), 0 0 40px rgba(14, 165, 233, 0.1) !important; }
              [data-mode="light"] .bulk-import-dropzone { background: rgba(14, 165, 233, 0.02) !important; border: 2px dashed rgba(14, 165, 233, 0.3) !important; }
              [data-mode="light"] .bulk-import-dropzone:hover { background: rgba(14, 165, 233, 0.05) !important; border-color: rgba(14, 165, 233, 0.6) !important; }
              [data-mode="light"] .bulk-import-icon-bg { background: rgba(14, 165, 233, 0.1) !important; border: 1px solid rgba(14, 165, 233, 0.2) !important; color: #0284c7 !important; }

              /* Animation keyframes */
              @keyframes spin-reel { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
              @keyframes counter-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(-360deg); } }
              .film-reel-spinner { display: flex; align-items: center; justify-content: center; animation: spin-reel 3s linear infinite, pulse-glow 3s ease-in-out infinite; }
              .bfi-logo-inner { animation: counter-spin 3s linear infinite; }
              @keyframes projector-flicker { 0%, 10%, 100% { opacity: 1; } 5% { opacity: 0.5; } 8% { opacity: 0.8; } }
              
              /* Dark Mode Theme (Classic Film Vibe - Cinematic Blue) */
              .processing-overlay { background: radial-gradient(circle at center, rgba(15, 23, 42, 0.98) 0%, rgba(2, 6, 23, 0.99) 100%); position: absolute; }
              .processing-overlay::before { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E"); opacity: 0.04; pointer-events: none; z-index: 1; }
              
              .projector-text { animation: projector-flicker 2s infinite; background: linear-gradient(135deg, #7dd3fc, #0284c7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-family: 'Playfair Display', serif; letter-spacing: 4px !important; }
              .film-reel-bg { background: conic-gradient(from 0deg, #0369a1, #38bdf8, #0369a1); border: none; padding: 4px; }
              .projector-beam { background: linear-gradient(90deg, rgba(56, 189, 248, 0.1) 0%, transparent 100%); }
              .processing-subtitle { color: #bae6fd; font-style: italic; }
              
              /* Light Mode Theme overrides */
              [data-mode="light"] .processing-overlay { background: radial-gradient(circle at center, rgba(255, 255, 255, 0.92) 0%, rgba(241, 245, 249, 0.98) 100%); }
              [data-mode="light"] .processing-overlay::before { display: none; }
              [data-mode="light"] .projector-text { font-family: var(--font-sans); letter-spacing: 2px !important; background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
              [data-mode="light"] .film-reel-bg { background: conic-gradient(from 0deg, rgba(192,39,74,0.8), rgba(192,39,74,0.2), rgba(192,39,74,0.8)); border: none; padding: 4px; animation: spin-reel 3s linear infinite, pulse-glow-light 3s ease-in-out infinite; }
              [data-mode="light"] .projector-beam { background: linear-gradient(90deg, rgba(192, 39, 74, 0.08) 0%, transparent 100%); }
              [data-mode="light"] .processing-subtitle { color: var(--text-muted); font-style: normal; }
              
              @keyframes pulse-glow { 0% { box-shadow: 0 0 20px rgba(56, 189, 248, 0.2), inset 0 0 20px rgba(0,0,0,0.8); } 50% { box-shadow: 0 0 60px rgba(56, 189, 248, 0.4), inset 0 0 20px rgba(0,0,0,0.8); } 100% { box-shadow: 0 0 20px rgba(56, 189, 248, 0.2), inset 0 0 20px rgba(0,0,0,0.8); } }
              @keyframes pulse-glow-light { 0% { box-shadow: 0 0 20px rgba(192, 39, 74, 0.1), inset 0 0 10px rgba(0,0,0,0.05); } 50% { box-shadow: 0 0 50px rgba(192, 39, 74, 0.3), inset 0 0 10px rgba(0,0,0,0.05); } 100% { box-shadow: 0 0 20px rgba(192, 39, 74, 0.1), inset 0 0 10px rgba(0,0,0,0.05); } }
              
              @keyframes light-beam { 0% { opacity: 0.2; transform: scaleX(1) translateY(-50%) rotate(-15deg); } 50% { opacity: 0.5; transform: scaleX(1.2) translateY(-50%) rotate(-15deg); } 100% { opacity: 0.2; transform: scaleX(1) translateY(-50%) rotate(-15deg); } }
            `}
          </style>

          <div className="modern-modal-content glass-panel shadow-2xl bulk-import-modal" style={{ width: '100%', maxWidth: '750px', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            
            {isProcessing && (
              <div className="animate-fade-in processing-overlay" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: 100, borderRadius: '20px', overflow: 'hidden' }}>
                {/* Projector Light Beam Effect */}
                <div className="projector-beam" style={{ position: 'absolute', top: '50%', left: '-10%', width: '150%', height: '150px', animation: 'light-beam 3s ease-in-out infinite', pointerEvents: 'none', transformOrigin: 'left center', zIndex: 0, filter: 'blur(8px)' }}></div>
                
                <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {/* Spinning conic-gradient ring with counter-spinning BFI logo inside */}
                  <div className="film-reel-spinner film-reel-bg" style={{ width: '110px', height: '110px', borderRadius: '50%' }}>
                    <div className="bfi-logo-inner" style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px' }}>
                      <img
                        src={`${import.meta.env.BASE_URL}bfi-logo.jpg`}
                        alt="BFI"
                        style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '50%' }}
                      />
                    </div>
                  </div>
                  <h2 className="processing-title" style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '1.25rem' }}>Generating Credentials...</h2>
                  <p className="processing-subtitle" style={{ fontSize: '0.9rem' }}>
                    {processedCount > 0 
                      ? `Processed ${processedCount} of ${previewData.length} records into the registry...`
                      : `Preparing ${previewData.length} records for import...`}
                  </p>
                </div>
              </div>
            )}

            <div className="modern-modal-header">
              <h3 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ background: 'linear-gradient(135deg, #0ea5e9, #0369a1)', padding: '0.4rem', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 4px 15px rgba(14, 165, 233, 0.3)' }}>
                  <Clapperboard size={20} />
                </div>
                Bulk Student Import
              </h3>
              <button type="button" className="icon-btn-ghost" onClick={closeModal} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="modern-modal-body" style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Seamlessly onboard entire batches of filmmakers at once.</p>
              
              {errorMsg && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  borderLeft: '4px solid #ef4444',
                  color: '#ef4444',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  fontSize: '0.9rem'
                }}>
                  <AlertCircle size={18} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {!results ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', position: 'relative' }}>
                  {/* Upload Zone */}
                  <div className={file ? "" : "bulk-import-dropzone"} style={{ 
                    padding: '2rem 1.5rem', 
                    borderRadius: '16px', 
                    border: file ? '2px solid var(--accent-primary)' : undefined, 
                    textAlign: 'center',
                    transition: 'all 0.3s ease',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.02)'
                  }}>
                    {/* Decorative film strip effect for the drop zone */}
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '10px', background: 'repeating-linear-gradient(90deg, transparent, transparent 10px, var(--glass-border) 10px, var(--glass-border) 20px)', opacity: 0.4 }}></div>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '10px', background: 'repeating-linear-gradient(90deg, transparent, transparent 10px, var(--glass-border) 10px, var(--glass-border) 20px)', opacity: 0.4 }}></div>

                    <input 
                      type="file" 
                      accept=".xlsx, .xls, .csv, .doc, .docx, .pdf" 
                      onChange={handleFileUpload} 
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 10 }} 
                      title="Click to upload"
                    />
                    
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', pointerEvents: 'none', position: 'relative', zIndex: 5 }}>
                      <div className={file ? "" : "bulk-import-icon-bg"} style={{ width: '64px', height: '64px', borderRadius: '50%', background: file ? 'rgba(192, 39, 74, 0.1)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', color: file ? 'var(--accent-primary)' : 'var(--text-muted)', transition: 'all 0.3s', boxShadow: '0 8px 20px rgba(0,0,0,0.05)', border: file ? '1px solid rgba(192,39,74,0.2)' : undefined }}>
                        {file ? (file.name.endsWith('.pdf') ? <FileText size={32} /> : file.name.match(/\.docx?$/) ? <FileText size={32} /> : <FileSpreadsheet size={32} />) : <Film size={32} />}
                      </div>
                      
                      {file ? (
                        <div className="animate-slide-up" style={{ animationDuration: '0.3s' }}>
                          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.1rem' }}>{file.name}</h3>
                          <div style={{ display: 'inline-block', marginTop: '0.5rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '0.3rem 0.75rem', borderRadius: '20px', fontWeight: '600', fontSize: '0.85rem' }}>
                            <CheckCircle2 size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '0.25rem' }} />
                            {previewData.length} valid students found
                          </div>
                        </div>
                      ) : (
                        <>
                          <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.1rem' }}>Drop your roster file here</h3>
                          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>Upload an XLSX, CSV, DOC/DOCX, or PDF containing student details</p>
                          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.75rem', background: 'var(--bg-tertiary)', padding: '0.3rem 0.8rem', borderRadius: '8px', marginTop: '0.25rem', maxWidth: '350px', lineHeight: 1.4 }}>
                            Auto-detects: Name, Email, Mobile, WhatsApp, Address, Gender, DOB, Profession, Education, Batch
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Configuration Options */}
                  {previewData.length > 0 && (
                    <div className="animate-slide-up" style={{ animationDelay: '0.1s', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text-primary)', fontWeight: '600', fontSize: '0.95rem' }}>Assign Batch Number</label>
                        <input 
                          type="text" 
                          value={batchNumber} 
                          onChange={(e) => setBatchNumber(e.target.value)} 
                          className="input-glass" 
                          placeholder="e.g. 53" 
                          style={{ width: '100%', paddingLeft: '1rem' }} 
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', marginBottom: '0.75rem', color: 'var(--text-primary)', fontWeight: '600', fontSize: '0.95rem' }}>Enroll in Courses</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                          {availableCourses.map(course => {
                            const isSelected = courses.includes(course.name);
                            return (
                              <label 
                                key={course.name} 
                                style={{ 
                                  display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', 
                                  background: isSelected ? 'var(--accent-primary)' : 'rgba(0,0,0,0.03)', 
                                  color: isSelected ? 'white' : 'var(--text-secondary)',
                                  padding: '0.6rem 1rem', borderRadius: '10px', 
                                  border: '1px solid', borderColor: isSelected ? 'var(--accent-primary)' : 'var(--glass-border)', 
                                  transition: 'all 0.2s ease',
                                  fontWeight: '500', fontSize: '0.85rem',
                                  boxShadow: isSelected ? '0 4px 12px rgba(14, 165, 233, 0.25)' : 'none'
                                }}
                              >
                                <input 
                                  type="checkbox" 
                                  checked={isSelected} 
                                  onChange={() => handleCourseChange(course.name)}
                                  style={{ display: 'none' }}
                                />
                                {isSelected ? <CheckCircle2 size={16} /> : <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid currentColor', opacity: 0.5 }}></div>}
                                {course.name}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="animate-slide-up" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '80px', height: '80px', borderRadius: '50%', background: results.some(r => r.status === 'error') ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: results.some(r => r.status === 'error') ? '#f59e0b' : '#10b981', marginBottom: '1.5rem' }}>
                    <CheckCircle2 size={40} />
                  </div>
                  <h3 style={{ fontSize: '1.75rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                    {results.some(r => r.status === 'error') ? 'Import Completed with Some Errors' : 'Roster Successfully Imported!'}
                  </h3>
                  
                  {(batchNumber || (results.length > 0 && results[0].year)) && (
                    <div style={{ display: 'inline-flex', gap: '1.5rem', background: 'var(--bg-tertiary)', padding: '0.5rem 1.25rem', borderRadius: '100px', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', border: '1px solid var(--glass-border)' }}>
                      {batchNumber && <div><span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Batch:</span> {batchNumber}</div>}
                      {results.length > 0 && results[0].year && <div><span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Year:</span> {results[0].year}</div>}
                    </div>
                  )}

                  <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '1rem', maxWidth: '500px', margin: '0 auto 1.5rem auto', lineHeight: 1.5 }}>
                    Processed <strong style={{ color: 'var(--text-primary)' }}>{results.length}</strong> records. 
                    <span style={{ color: '#10b981', marginLeft: '0.5rem' }}>{results.filter(r => r.status === 'success').length} successful</span>
                    {results.some(r => r.status === 'error') && (
                      <span style={{ color: '#ef4444', marginLeft: '0.5rem' }}>{results.filter(r => r.status === 'error').length} failed</span>
                    )}
                  </p>

                  {results.some(r => r.status === 'error') && (
                    <div style={{ textAlign: 'left', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1rem', borderRadius: '8px', marginBottom: '2rem', maxHeight: '150px', overflowY: 'auto' }}>
                      <h4 style={{ margin: '0 0 0.5rem 0', color: '#ef4444', fontSize: '0.95rem' }}>Failed Imports:</h4>
                      <ul style={{ margin: 0, paddingLeft: '1.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        {results.filter(r => r.status === 'error').map((errRow, idx) => (
                          <li key={idx} style={{ marginBottom: '0.25rem' }}>
                            <strong>{errRow.name || errRow.email || 'Unknown User'}</strong>: {errRow.error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              {!results ? (
                <>
                  <button type="button" onClick={closeModal} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>
                    Cancel
                  </button>
                  {previewData.length > 0 && (
                    <button 
                      type="button"
                      onClick={handleImport} 
                      disabled={isProcessing}
                      className="modern-btn modern-btn--primary"
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                    >
                      {isProcessing ? 'Processing...' : `Import ${previewData.length} Students`}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button type="button" onClick={closeModal} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>
                    Close
                  </button>
                  <button 
                    type="button"
                    onClick={handleDownloadResults} 
                    className="modern-btn modern-btn--primary"
                    style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                  >
                    <FileSpreadsheet size={18} />
                    Download Generated Credentials
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      , document.body)}

      {isHistoryOpen && createPortal(
        <div className="modern-modal-overlay" onClick={() => setIsHistoryOpen(false)}>
          <div className="modern-modal-content glass-panel shadow-2xl" style={{ width: '100%', maxWidth: '600px', margin: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modern-modal-header">
              <h3 className="font-display" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ background: 'var(--bg-tertiary)', padding: '0.5rem', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                  <History size={24} />
                </div>
                Import History
              </h3>
              <button type="button" className="icon-btn-ghost" onClick={() => setIsHistoryOpen(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="modern-modal-body" style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Download credentials from past imports.</p>

              {loadingHistory ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Loading history...</div>
              ) : historyList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem 2rem', background: 'var(--bg-tertiary)', borderRadius: '16px', color: 'var(--text-muted)' }}>
                  No import history found.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {historyList.map(item => (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)', borderRadius: '12px' }}>
                      <div>
                        <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>{getOrdinalSuffix(item.batch_number)} Batch</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{new Date(item.created_at).toLocaleString()}</div>
                      </div>
                      <button 
                        onClick={() => handleDownloadOldResults(item.id, item.batch_number)}
                        style={{ 
                          background: 'rgba(14, 165, 233, 0.1)', 
                          color: 'var(--accent-primary)', 
                          border: 'none', 
                          padding: '0.5rem 1rem', 
                          borderRadius: '8px', 
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          fontWeight: '600',
                          fontSize: '0.9rem',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(14, 165, 233, 0.2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(14, 165, 233, 0.1)'}
                      >
                        <Download size={16} />
                        Download
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modern-modal-footer" style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setIsHistoryOpen(false)} className="modern-btn modern-btn--secondary" style={{ flex: 1 }}>Close</button>
            </div>
          </div>
        </div>
      , document.body)}
    </>
  );
}
