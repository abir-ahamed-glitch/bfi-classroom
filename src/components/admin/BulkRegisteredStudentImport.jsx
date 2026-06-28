import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { UploadCloud, CheckCircle2, FileSpreadsheet, X, AlertCircle, History, Download, Clapperboard, Film, FileText } from 'lucide-react';
import { getOrdinalSuffix } from '../../utils/formatUtils';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export default function BulkRegisteredStudentImport({ onImportComplete }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  const [file, setFile] = useState(null);
  const [previewData, setPreviewData] = useState([]);
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
      XLSX.writeFile(newWb, `BFI_Registered_Students_Import_History.xlsx`);
    } catch (err) {
      console.error(err);
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
        if (fileExt === 'docx') {
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
          // Fallback if no tables but there are paragraphs (one student per line maybe)
          if (data2D.length === 0) {
             const paragraphs = doc.querySelectorAll('p');
             paragraphs.forEach(p => {
               const text = p.innerText.trim();
               if (text) data2D.push(text.split(/\s{2,}|\t|\||,/)); // Split by tabs, multiple spaces, pipes, or commas
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
        return;
      }

      // Find the actual header row (some files have titles/empty lines at the top)
      let headerRowIdx = -1;
      let headerMap = {};

      const mappedData = [];
      let detectedBatch = '';
      let detectedYear = '';

      for (let i = 0; i < data2D.length; i++) {
        const row = data2D[i];
        if (!row || !Array.isArray(row)) continue;
        
        // Try to detect Batch and Year from text above the table headers
        if (headerRowIdx === -1) {
          for (let j = 0; j < row.length; j++) {
            if (typeof row[j] === 'string') {
              const val = row[j].trim();
              const batchMatch = val.match(/(\d+)(?:st|nd|rd|th)?\s*(?:[Bb]atch|[Ff]ilm|[Cc]ourse)/);
              if (batchMatch && !detectedBatch) {
                detectedBatch = batchMatch[1];
              }
              const yearMatch = val.match(/(?:19|20)\d{2}/);
              if (yearMatch && !detectedYear) {
                detectedYear = yearMatch[0];
              }
            }
          }
        }
        
        let foundName = -1, foundEmail = -1, foundMobile = -1, foundAddress = -1, foundSN = -1, foundYear = -1, foundBatch = -1;
        let foundGender = -1, foundBirthday = -1, foundProfession = -1, foundEducation = -1, foundWhatsapp = -1, foundPermanentAddress = -1;
        
        for (let j = 0; j < row.length; j++) {
          if (!row[j] || typeof row[j] !== 'string') continue;
          const val = row[j].toLowerCase().trim();
          
          if (val.includes('name') || val.includes('student')) foundName = j;
          if (val.includes('mail')) foundEmail = j;
          if (val.includes('mobile') || val.includes('phone') || val.includes('contact')) foundMobile = j;
          if (val.includes('whatsapp')) foundWhatsapp = j;
          
          if (val.includes('permanent address')) foundPermanentAddress = j;
          else if (val.includes('present address') || val.includes('current address')) foundAddress = j;
          else if (val.includes('address') || val.includes('city') || val.includes('location')) {
            if (foundAddress === -1) foundAddress = j;
          }
          
          if (val === 'sn' || val === 'no' || val === 's/n' || val === 'n.o.' || val.includes('serial')) foundSN = j;
          if (val.includes('year') || val === 'yr') foundYear = j;
          if (val.includes('batch')) foundBatch = j;
          
          if (val === 'gender' || val === 'sex') foundGender = j;
          if (val.includes('birth') || val === 'dob') foundBirthday = j;
          if (val.includes('profession') || val.includes('occupation') || val === 'job') foundProfession = j;
          if (val.includes('education') || val.includes('qualification') || val.includes('degree')) foundEducation = j;
        }

        // If we found the 'Name' column and at least one contact column, we assume this is the header row
        if (foundName !== -1 && (foundMobile !== -1 || foundEmail !== -1)) {
          headerRowIdx = i;
          headerMap = { 
            sn: foundSN, name: foundName, address: foundAddress, permanentAddress: foundPermanentAddress,
            mobile: foundMobile, whatsapp: foundWhatsapp, email: foundEmail, year: foundYear, batch: foundBatch,
            gender: foundGender, birthday: foundBirthday, profession: foundProfession, education: foundEducation
          };
          break;
        }
      }

      if (headerRowIdx === -1) {
        // Fallback: Guess columns from the first few rows if there are no clear headers
        let guessedName = -1, guessedEmail = -1, guessedMobile = -1;
        for (let i = 0; i < Math.min(10, data2D.length); i++) {
          const row = data2D[i];
          if (!row || !Array.isArray(row)) continue;
          for (let j = 0; j < row.length; j++) {
            if (!row[j]) continue;
            const val = String(row[j]).trim();
            if (val.includes('@') && val.includes('.')) guessedEmail = j;
            else if (/^\+?\d{10,14}$/.test(val.replace(/[\s-]/g, ''))) guessedMobile = j;
            else if (val.length > 2 && isNaN(val) && !val.toLowerCase().includes('http') && guessedName === -1) guessedName = j;
          }
          if (guessedName !== -1 || guessedEmail !== -1 || guessedMobile !== -1) {
            headerRowIdx = i - 1;
            headerMap = { 
              sn: -1, name: guessedName, address: -1, permanentAddress: -1,
              mobile: guessedMobile, whatsapp: -1, email: guessedEmail, year: -1, batch: -1,
              gender: -1, birthday: -1, profession: -1, education: -1
            };
            break;
          }
        }

        if (headerRowIdx === -1) {
          setErrorMsg("Could not detect the table headers automatically. Please ensure columns like 'Name of the Student' and 'Mobile' exist.");
          setPreviewData([]);
          return;
        }
      }

      for (let i = headerRowIdx + 1; i < data2D.length; i++) {
        const row = data2D[i];
        if (!row || !Array.isArray(row) || row.length === 0) continue;

        const name = headerMap.name !== -1 && row[headerMap.name] ? String(row[headerMap.name]).trim() : '';
        
        let email = headerMap.email !== -1 && row[headerMap.email] ? String(row[headerMap.email]).trim() : '';
        if (email) email = email.split(/[,/\n]/)[0].trim();
        
        let rawMobile = headerMap.mobile !== -1 && row[headerMap.mobile] ? String(row[headerMap.mobile]).trim() : '';
        let mobile = '';

        // Smart extraction of email and phone if combined in the phone field
        if (rawMobile) {
          const emailRegex = /([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6})/;
          const emailMatch = rawMobile.match(emailRegex);
          if (emailMatch) {
            if (!email) {
              email = emailMatch[1];
            }
            // Remove the email string from the mobile field
            rawMobile = rawMobile.replace(emailMatch[0], '').trim();
          }

          // Split multiple phone numbers if present
          const phoneParts = rawMobile.split(/[,/;\n]+/).map(p => p.trim()).filter(Boolean);
          for (const part of phoneParts) {
            const cleanPart = part.replace(/[^\d+]/g, '');
            if (cleanPart.length >= 7) {
              mobile = cleanPart;
              // Add leading zero if dropped by Excel
              if (mobile.length === 10 && mobile.startsWith('1')) {
                mobile = '0' + mobile;
              }
              break;
            }
          }
          // Landline or short number fallback
          if (!mobile && phoneParts.length > 0) {
            mobile = phoneParts[0].replace(/[^\d+]/g, '');
          }
        }
        
        // Skip completely empty rows
        if (!name && !email && !mobile) continue;

        const snNo = headerMap.sn !== -1 && row[headerMap.sn] ? String(row[headerMap.sn]).trim() : String(mappedData.length + 1);
        const year = headerMap.year !== -1 && row[headerMap.year] ? String(row[headerMap.year]).trim() : detectedYear || new Date().getFullYear().toString();
        let batch = headerMap.batch !== -1 && row[headerMap.batch] ? String(row[headerMap.batch]).trim() : detectedBatch || '';
        
        // Normalize batch like '1st' to '1'
        if (batch) {
          const normBatchMatch = batch.match(/^(\d+)(?:st|nd|rd|th)?$/i);
          if (normBatchMatch) {
            batch = normBatchMatch[1];
          }
        }

        const address = headerMap.address !== -1 && row[headerMap.address] ? String(row[headerMap.address]).trim() : '';
        const permanentAddress = headerMap.permanentAddress !== -1 && row[headerMap.permanentAddress] ? String(row[headerMap.permanentAddress]).trim() : '';
        const gender = headerMap.gender !== -1 && row[headerMap.gender] ? String(row[headerMap.gender]).trim() : '';
        const birthday = headerMap.birthday !== -1 && row[headerMap.birthday] ? String(row[headerMap.birthday]).trim() : '';
        const profession = headerMap.profession !== -1 && row[headerMap.profession] ? String(row[headerMap.profession]).trim() : '';
        const education = headerMap.education !== -1 && row[headerMap.education] ? String(row[headerMap.education]).trim() : '';
        const whatsapp = headerMap.whatsapp !== -1 && row[headerMap.whatsapp] ? String(row[headerMap.whatsapp]).trim() : '';

        // Original row needs to be a standard object to pass gracefully, or we just pass the array
        mappedData.push({ 
          snNo, year, batch, name, address, permanentAddress, gender, birthday, 
          profession, education, whatsapp, mobile, email, originalRow: row 
        });
      }

      setPreviewData(mappedData);
    };
    reader.readAsBinaryString(uploadedFile);
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
          const res = await fetch('/api/admin/students/bulk?skipExisting=true&isRegisteredOnly=true', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
              students: [student],
              batchNumber: '',
              courses: []
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
          batchNumber: 'Registered',
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

  const closeModal = () => {
    setIsOpen(false);
    setFile(null);
    setPreviewData([]);
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
          <span>Bulk Upload Registered Students</span>
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
              .film-reel-spinner { animation: spin-reel 2s linear infinite; display: flex; }
              @keyframes projector-flicker { 0%, 10%, 100% { opacity: 1; } 5% { opacity: 0.5; } 8% { opacity: 0.8; } }
              
              /* Dark Mode Theme (Classic Film Vibe - Cinematic Blue) */
              .processing-overlay { background: radial-gradient(circle at center, rgba(15, 23, 42, 0.98) 0%, rgba(2, 6, 23, 0.99) 100%); position: absolute; }
              .processing-overlay::before { content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E"); opacity: 0.04; pointer-events: none; z-index: 1; }
              
              .projector-text { animation: projector-flicker 2s infinite; background: linear-gradient(135deg, #7dd3fc, #0284c7); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-family: 'Playfair Display', serif; letter-spacing: 4px !important; }
              .film-reel-bg { background: linear-gradient(135deg, #0c4a6e, #082f49); border: 2px solid #0369a1; color: #38bdf8; animation: spin-reel 2s linear infinite, pulse-glow 3s ease-in-out infinite; }
              .projector-beam { background: linear-gradient(90deg, rgba(56, 189, 248, 0.1) 0%, transparent 100%); }
              .processing-subtitle { color: #bae6fd; font-style: italic; }
              
              /* Light Mode Theme overrides */
              [data-mode="light"] .processing-overlay { background: radial-gradient(circle at center, rgba(255, 255, 255, 0.92) 0%, rgba(241, 245, 249, 0.98) 100%); }
              [data-mode="light"] .processing-overlay::before { display: none; }
              [data-mode="light"] .projector-text { font-family: var(--font-sans); letter-spacing: 2px !important; background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
              [data-mode="light"] .film-reel-bg { background: linear-gradient(135deg, #ffffff, #f8fafc); border: 2px solid rgba(192, 39, 74, 0.3); color: var(--accent-primary); animation: spin-reel 2s linear infinite, pulse-glow-light 3s ease-in-out infinite; }
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
                  <div className="film-reel-spinner film-reel-bg" style={{ padding: '1.25rem', borderRadius: '50%' }}>
                    <Film size={64} strokeWidth={1.5} />
                  </div>
                  <h2 className="processing-title" style={{ marginTop: '1.5rem', marginBottom: '0.5rem', fontSize: '1.25rem' }}>Importing Student Leads...</h2>
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
                Bulk Registered Student Import
              </h3>
              <button type="button" className="icon-btn-ghost" onClick={closeModal} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="modern-modal-body" style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Upload registered students effortlessly to build your applicant database.</p>
              
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
                      accept=".xlsx, .xls, .csv" 
                      onChange={handleFileUpload} 
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 10 }} 
                      title="Click to upload"
                    />
                    
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', pointerEvents: 'none', position: 'relative', zIndex: 5 }}>
                      <div className={file ? "" : "bulk-import-icon-bg"} style={{ width: '64px', height: '64px', borderRadius: '50%', background: file ? 'rgba(192, 39, 74, 0.1)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', color: file ? 'var(--accent-primary)' : 'var(--text-muted)', transition: 'all 0.3s', boxShadow: '0 8px 20px rgba(0,0,0,0.05)', border: file ? '1px solid rgba(192,39,74,0.2)' : undefined }}>
                        {file ? <FileSpreadsheet size={32} /> : <Film size={32} />}
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
                          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>Upload an XLSX or CSV containing student details</p>
                          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.75rem', background: 'var(--bg-tertiary)', padding: '0.3rem 0.8rem', borderRadius: '8px', marginTop: '0.25rem', maxWidth: '350px', lineHeight: 1.4 }}>
                            Auto-detects: Name, Email, Mobile, WhatsApp, Address, Gender, DOB, Profession, Education
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="animate-slide-up" style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '80px', height: '80px', borderRadius: '50%', background: results.some(r => r.status === 'error') ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: results.some(r => r.status === 'error') ? '#f59e0b' : '#10b981', marginBottom: '1.5rem' }}>
                    <CheckCircle2 size={40} />
                  </div>
                  <h3 style={{ fontSize: '1.75rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                    {results.some(r => r.status === 'error') ? 'Import Completed with Some Errors' : 'Students Successfully Registered!'}
                  </h3>
                  
                  {results.length > 0 && results[0].year && (
                    <div style={{ display: 'inline-flex', gap: '1.5rem', background: 'var(--bg-tertiary)', padding: '0.5rem 1.25rem', borderRadius: '100px', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', border: '1px solid var(--glass-border)' }}>
                      <div><span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Year:</span> {results[0].year}</div>
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
                  <button type="button" onClick={closeModal} className="modern-btn modern-btn--primary" style={{ flex: 1 }}>
                    Close & Finish
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
                        <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>{item.batch_number === 'Registered' ? 'Registered Students Import' : `${getOrdinalSuffix(item.batch_number)} Batch`}</div>
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
