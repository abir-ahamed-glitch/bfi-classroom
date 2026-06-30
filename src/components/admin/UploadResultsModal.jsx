import React, { useState, useEffect } from 'react';
import { Upload, X, Check, AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import './BatchFormModal.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export default function UploadResultsModal({ isOpen, onClose, batchId, onUploadSuccess }) {
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [previewData, setPreviewData] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setFile(null);
      setErrorMsg('');
      setPreviewData([]);
      setIsProcessing(false);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const onDrop = (acceptedFiles) => {
    if (!acceptedFiles || acceptedFiles.length === 0) return;
    const uploadedFile = acceptedFiles[0];
    handleFileUpload(uploadedFile);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
      'application/pdf': ['.pdf']
    },
    multiple: false
  });

  const handleFileUpload = (uploadedFile) => {
    setIsProcessing(true);
    setErrorMsg('');
    setFile(uploadedFile);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      let data2D = [];
      const fileExt = uploadedFile.name.split('.').pop().toLowerCase();

      try {
        if (fileExt === 'pdf') {
          const loadingTask = pdfjsLib.getDocument(new Uint8Array(evt.target.result));
          const pdf = await loadingTask.promise;
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            
            const rowsMap = new Map();
            content.items.forEach(item => {
              const y = Math.round(item.transform[5] / 5) * 5; 
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
          const bstr = new Uint8Array(evt.target.result);
          const wb = XLSX.read(bstr, { type: 'array' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          data2D = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        }
      } catch (parseErr) {
        console.error("Parse error:", parseErr);
        setErrorMsg("Failed to parse file. Please ensure it's a valid Excel, CSV, or PDF document.");
        setPreviewData([]);
        setIsProcessing(false);
        return;
      }

      const mappedResults = [];

      const looksLikeName = (val) => {
        if (!val || val.length < 3 || val.length > 50) return false;
        if (/^\d/.test(val)) return false;
        if (/@/.test(val)) return false;
        if (/\b(marks|roll|pass|fail|result|exam)\b/i.test(val)) return false;
        return /^[a-zA-Z\s.-]+$/.test(val);
      };

      for (let i = 0; i < data2D.length; i++) {
        const row = data2D[i];
        if (!row || !Array.isArray(row) || row.length === 0) continue;
        
        const rowText = row.join(' ').toLowerCase();
        
        if (rowText.includes('total marks') || rowText.includes('obtained marks') || rowText.includes('result of the examination')) continue;

        let name = '';
        let rollNo = '';
        let obtainedMarks = null;
        let totalMarks = 100;
        let remarks = '';

        for (let j = 0; j < row.length; j++) {
          const cell = String(row[j] || '').trim();
          if (!cell) continue;
          
          const lowerCell = cell.toLowerCase();

          if (lowerCell === 'pass' || lowerCell === 'fail' || lowerCell === 'passed' || lowerCell === 'failed') {
            remarks = lowerCell.includes('pass') ? 'Pass' : 'Fail';
            continue;
          }

          if (/^\d{1,3}(\.\d+)?$/.test(cell)) {
             const num = parseFloat(cell);
             if (num <= 100 && num >= 0) {
               if (!rollNo && num < 100 && String(num).length <= 2) {
                 rollNo = cell;
               } else if (obtainedMarks === null) {
                 obtainedMarks = num;
               } else if (num === 100 && obtainedMarks !== null) {
                 totalMarks = num;
               }
             }
             continue;
          }
          
          if (!name && looksLikeName(cell)) {
            name = cell;
          }
        }

        if (name && (obtainedMarks !== null || remarks)) {
           if (!remarks && obtainedMarks !== null) {
              remarks = obtainedMarks >= 40 ? 'Pass' : 'Fail';
           }
           
           mappedResults.push({
             name,
             rollNo,
             obtainedMarks: obtainedMarks !== null ? obtainedMarks : '',
             remarks: remarks || 'Unknown'
           });
        }
      }

      setPreviewData(mappedResults);
      setIsProcessing(false);
      
      if (mappedResults.length === 0) {
        setErrorMsg("Could not detect any valid exam results in this file. Please ensure the file contains Name and Marks columns.");
      }
    };
    
    reader.readAsArrayBuffer(uploadedFile);
  };

  const handleUploadResults = async () => {
    if (previewData.length === 0) return;
    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/batches/${batchId}/results/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ results: previewData })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload results');
      }

      onUploadSuccess(data);
      onClose();
    } catch (error) {
      setErrorMsg(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-container" style={{ maxWidth: '800px', width: '90%' }}>
        <div className="modal-header">
          <h2>Upload Exam Results</h2>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        
        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', padding: '1.5rem' }}>
          
          {errorMsg && (
            <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Upload Error</strong>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>{errorMsg}</p>
              </div>
            </div>
          )}

          {!file ? (
            <div {...getRootProps()} style={{ 
              border: `2px dashed ${isDragActive ? '#3b82f6' : 'rgba(255,255,255,0.2)'}`,
              borderRadius: '12px',
              padding: '3rem 2rem',
              textAlign: 'center',
              cursor: 'pointer',
              background: isDragActive ? 'rgba(59, 130, 246, 0.05)' : 'rgba(255,255,255,0.02)',
              transition: 'all 0.2s ease'
            }}>
              <input {...getInputProps()} />
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                <Upload size={32} />
              </div>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', color: 'var(--text-primary)' }}>
                {isDragActive ? 'Drop file here' : 'Drag & drop result file'}
              </h3>
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                Supports .xlsx, .csv, and .pdf
              </p>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <FileText size={24} color="#3b82f6" />
                  <div>
                    <div style={{ fontWeight: '500', color: 'var(--text-primary)' }}>{file.name}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                </div>
                <button 
                  onClick={() => { setFile(null); setPreviewData([]); setErrorMsg(''); }}
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.9rem', padding: '0.5rem' }}
                >
                  Remove
                </button>
              </div>

              {isProcessing ? (
                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                  <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto 1rem auto' }} />
                  <p>Analyzing results...</p>
                </div>
              ) : previewData.length > 0 ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>Detected Results ({previewData.length})</h3>
                  </div>
                  
                  <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                      <thead style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <tr>
                          <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontWeight: '500', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Name</th>
                          <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontWeight: '500', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Roll No</th>
                          <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontWeight: '500', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Marks</th>
                          <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontWeight: '500', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.slice(0, 50).map((row, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{row.name}</td>
                            <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{row.rollNo || '-'}</td>
                            <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{row.obtainedMarks !== '' ? row.obtainedMarks : '-'}</td>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              <span style={{ 
                                padding: '2px 8px', 
                                borderRadius: '12px', 
                                fontSize: '0.8rem',
                                background: row.remarks === 'Pass' ? 'rgba(34, 197, 94, 0.1)' : row.remarks === 'Fail' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.1)',
                                color: row.remarks === 'Pass' ? '#22c55e' : row.remarks === 'Fail' ? '#ef4444' : 'var(--text-muted)'
                              }}>
                                {row.remarks}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {previewData.length > 50 && (
                    <div style={{ textAlign: 'center', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Showing first 50 of {previewData.length} records
                    </div>
                  )}
                </div>
              ) : null}

            </div>
          )}
        </div>

        <div className="modal-footer" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '1rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button onClick={onClose} className="modern-btn modern-btn--secondary" disabled={isSubmitting}>
            Cancel
          </button>
          <button 
            onClick={handleUploadResults} 
            className="modern-btn modern-btn--primary"
            disabled={previewData.length === 0 || isSubmitting}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {isSubmitting ? 'Updating Profiles...' : 'Upload Results'}
          </button>
        </div>
      </div>
    </div>
  );
}
