import React, { useEffect, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Import react-pdf CSS for text selection and annotation layers
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure worker — Vite ?url import bundles the matching worker as a same-origin asset
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const SCALE_STEP = 0.25;
const SCALE_MIN = 0.5;
const SCALE_MAX = 3.0;

export default function PdfViewer({ url, name, containerStyle = {} }) {
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);

  useEffect(() => {
    if (!url) return;

    let isMounted = true;

    // Check if the URL is our custom base64 API endpoint
    if (url.includes('/base64')) {
      Promise.resolve().then(() => {
        if (isMounted) {
          setLoading(true);
          setError(null);
        }
      });
      let objectUrl = null;

      fetch(url)
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
          }
          return response.json();
        })
        .then(data => {
          if (!isMounted) return;
          if (!data || !data.base64) {
            throw new Error('No base64 data returned from server');
          }

          // Decode base64 to binary array
          const binaryString = atob(data.base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          // Create Blob and local URL
          const blob = new Blob([bytes], { type: data.file_type || 'application/pdf' });
          objectUrl = URL.createObjectURL(blob);
          if (isMounted) {
            setResolvedUrl(objectUrl);
            setLoading(false);
          }
        })
        .catch(err => {
          console.error('[PdfViewer error]', err);
          if (isMounted) {
            setError(err.message);
            setLoading(false);
          }
        });

      return () => {
        isMounted = false;
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      };
    } else {
      // Direct file URL
      Promise.resolve().then(() => {
        if (isMounted) {
          setResolvedUrl(url);
          setLoading(false);
          setError(null);
        }
      });
      return () => {
        isMounted = false;
      };
    }
  }, [url]);

  const handleLoadSuccess = ({ numPages: n }) => {
    setNumPages(n);
    setPageNumber(1);
  };

  const handleLoadError = (err) => {
    console.error('[PdfViewer load error]', err);
    setError(err.message || 'Failed to load PDF');
  };

  const prevPage = () => setPageNumber(p => Math.max(1, p - 1));
  const nextPage = () => setPageNumber(p => Math.min(numPages || 1, p + 1));
  const zoomOut = () => setScale(s => Math.max(SCALE_MIN, parseFloat((s - SCALE_STEP).toFixed(2))));
  const zoomIn = () => setScale(s => Math.min(SCALE_MAX, parseFloat((s + SCALE_STEP).toFixed(2))));

  const toolbarStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    padding: '0.5rem 1rem',
    background: 'rgba(0,0,0,0.08)',
    borderBottom: '1px solid rgba(0,0,0,0.1)',
    flexShrink: 0,
    flexWrap: 'wrap',
  };

  const btnStyle = {
    padding: '4px 10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: '#333',
    lineHeight: 1.4,
  };

  const btnDisabledStyle = {
    ...btnStyle,
    opacity: 0.4,
    cursor: 'not-allowed',
  };

  const labelStyle = {
    fontSize: '0.85rem',
    color: '#555',
    userSelect: 'none',
    minWidth: '80px',
    textAlign: 'center',
  };

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '90%',
        maxWidth: '1200px',
        height: '88vh',
        background: '#fff',
        borderRadius: '14px',
        overflow: 'hidden',
        boxShadow: '0 32px 100px rgba(0,0,0,0.85)',
        border: '1px solid rgba(255,255,255,0.08)',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#333',
        ...containerStyle,
      }}
    >
      {loading && (
        <div style={{ padding: '2rem', fontSize: '1.2rem', color: '#666', fontWeight: 500 }}>
          Decoding PDF secure payload...
        </div>
      )}

      {error && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#d32f2f' }}>
          <h3 style={{ margin: '0 0 0.5rem 0' }}>Failed to Load PDF</h3>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#666' }}>{error}</p>
        </div>
      )}

      {!loading && !error && resolvedUrl && (
        <>
          {/* Toolbar */}
          <div style={toolbarStyle}>
            {/* Page navigation */}
            <button
              style={pageNumber <= 1 ? btnDisabledStyle : btnStyle}
              disabled={pageNumber <= 1}
              onClick={prevPage}
              aria-label="Previous page"
            >
              ‹ Prev
            </button>
            <span style={labelStyle}>
              {pageNumber} / {numPages || '—'}
            </span>
            <button
              style={pageNumber >= (numPages || 1) ? btnDisabledStyle : btnStyle}
              disabled={pageNumber >= (numPages || 1)}
              onClick={nextPage}
              aria-label="Next page"
            >
              Next ›
            </button>

            {/* Zoom controls */}
            <button
              style={scale <= SCALE_MIN ? btnDisabledStyle : btnStyle}
              disabled={scale <= SCALE_MIN}
              onClick={zoomOut}
              aria-label="Zoom out"
            >
              −
            </button>
            <span style={labelStyle}>{Math.round(scale * 100)}%</span>
            <button
              style={scale >= SCALE_MAX ? btnDisabledStyle : btnStyle}
              disabled={scale >= SCALE_MAX}
              onClick={zoomIn}
              aria-label="Zoom in"
            >
              +
            </button>

            {/* Download */}
            <a
              href={resolvedUrl}
              download={name || 'document.pdf'}
              style={{ ...btnStyle, textDecoration: 'none', display: 'inline-block' }}
              aria-label="Download PDF"
            >
              ↓ Download
            </a>
          </div>

          {/* PDF viewer — scrollable page area */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '1rem', background: '#e0e0e0' }}>
            <Document
              file={resolvedUrl}
              onLoadSuccess={handleLoadSuccess}
              onLoadError={handleLoadError}
              options={{ isEvalSupported: false }}
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>
          </div>
        </>
      )}
    </div>
  );
}
