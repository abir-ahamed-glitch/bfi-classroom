import React, { useEffect, useState, useRef, useCallback } from 'react';
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
  const [rotation, setRotation] = useState(0);
  const [fitWidth, setFitWidth] = useState(true);
  const [containerWidth, setContainerWidth] = useState(800);

  // Features: Thumbnails sidebar, Search, Print
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState('');

  // Page input jump state
  const [pageInputVal, setPageInputVal] = useState('1');

  // References
  const rootContainerRef = useRef(null);
  const viewerBodyRef = useRef(null);
  const pdfDocRef = useRef(null);
  const pagesTextCacheRef = useRef(null);

  // Resolve direct URL or custom base64 API endpoint
  useEffect(() => {
    if (!url) {
      setResolvedUrl(null);
      setError(null);
      return;
    }

    let isMounted = true;
    pagesTextCacheRef.current = null;
    setSearchResults([]);
    setCurrentMatchIndex(0);

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
            setError(err.message || 'Failed to load PDF');
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

  // Responsive container width tracking via ResizeObserver
  useEffect(() => {
    const el = viewerBodyRef.current || rootContainerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const target = viewerBodyRef.current || rootContainerRef.current;
      if (target && target.clientWidth > 0) {
        setContainerWidth(target.clientWidth);
      }
    };

    updateWidth();

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateWidth();
      });
      resizeObserver.observe(el);
      if (rootContainerRef.current && rootContainerRef.current !== el) {
        resizeObserver.observe(rootContainerRef.current);
      }
    } else {
      window.addEventListener('resize', updateWidth);
    }

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, [showThumbnails, resolvedUrl, numPages]);

  // Document load handler
  const handleLoadSuccess = (doc) => {
    pdfDocRef.current = doc;
    setNumPages(doc.numPages);
    setPageNumber(1);
    setPageInputVal('1');
    setError(null);

    // Build page text cache in background for fast search
    const cache = [];
    pagesTextCacheRef.current = null;
    const loadPromises = [];
    for (let i = 1; i <= doc.numPages; i++) {
      loadPromises.push(
        doc.getPage(i).then(page => page.getTextContent()).then(tc => {
          const text = tc.items.map(item => item.str).join(' ');
          cache[i] = text;
        }).catch(() => {
          cache[i] = '';
        })
      );
    }
    Promise.all(loadPromises).then(() => {
      pagesTextCacheRef.current = cache;
    });
  };

  const handleLoadError = (err) => {
    console.error('[PdfViewer load error]', err);
    setError(err.message || 'Failed to load PDF');
  };

  // Page navigation
  const goToPage = useCallback((p) => {
    const target = Math.max(1, Math.min(numPages || 1, p));
    setPageNumber(target);
    setPageInputVal(String(target));
  }, [numPages]);

  const prevPage = () => goToPage(pageNumber - 1);
  const nextPage = () => goToPage(pageNumber + 1);

  const handlePageInputChange = (e) => {
    setPageInputVal(e.target.value);
  };

  const handlePageInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      const parsed = parseInt(pageInputVal, 10);
      if (!isNaN(parsed)) {
        goToPage(parsed);
      } else {
        setPageInputVal(String(pageNumber));
      }
    }
  };

  const handlePageInputBlur = () => {
    const parsed = parseInt(pageInputVal, 10);
    if (!isNaN(parsed)) {
      goToPage(parsed);
    } else {
      setPageInputVal(String(pageNumber));
    }
  };

  // Zoom controls
  const zoomOut = () => {
    setFitWidth(false);
    setScale(s => Math.max(SCALE_MIN, parseFloat((s - SCALE_STEP).toFixed(2))));
  };

  const zoomIn = () => {
    setFitWidth(false);
    setScale(s => Math.min(SCALE_MAX, parseFloat((s + SCALE_STEP).toFixed(2))));
  };

  const toggleFitWidth = () => {
    setFitWidth(true);
    setScale(1.0);
  };

  const rotateClockwise = () => {
    setRotation(r => (r + 90) % 360);
  };

  // Search logic across all pages
  const executeSearch = useCallback((query) => {
    if (!query || !query.trim()) {
      setSearchResults([]);
      setCurrentMatchIndex(0);
      return;
    }

    const q = query.trim().toLowerCase();
    const cache = pagesTextCacheRef.current || [];
    const matches = [];

    cache.forEach((text, pNum) => {
      if (!text) return;
      const lower = text.toLowerCase();
      let pos = 0;
      while ((pos = lower.indexOf(q, pos)) !== -1) {
        matches.push({ pageNumber: pNum, index: pos });
        pos += q.length;
      }
    });

    setSearchResults(matches);
    setCurrentMatchIndex(0);
    if (matches.length > 0) {
      goToPage(matches[0].pageNumber);
    }
  }, [goToPage]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    executeSearch(searchQuery);
  };

  const nextMatch = () => {
    if (searchResults.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % searchResults.length;
    setCurrentMatchIndex(nextIdx);
    goToPage(searchResults[nextIdx].pageNumber);
  };

  const prevMatch = () => {
    if (searchResults.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + searchResults.length) % searchResults.length;
    setCurrentMatchIndex(prevIdx);
    goToPage(searchResults[prevIdx].pageNumber);
  };

  // Highlight search matches in text layer — must return string per react-pdf CustomTextRenderer contract
  const customTextRenderer = useCallback(({ str }) => {
    if (!searchQuery || !searchQuery.trim()) return str;
    const q = searchQuery.trim();
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return str.replace(regex, '<mark>$1</mark>');
  }, [searchQuery]);

  // Whole-document printing
  const handlePrint = () => {
    setIsPrinting(true);
    setPrintStatus('Preparing full document for printing...');
    // Allow offscreen full-document render to mount
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
      setPrintStatus('');
    }, 700);
  };

  // Computed base page width for responsive fit-to-width and proportional zoom
  const sidebarWidth = showThumbnails ? 140 : 0;
  const paddingX = 32;
  const basePageWidth = Math.max(120, Math.floor(containerWidth - sidebarWidth - paddingX));

  // Responsive CSS styles
  const toolbarStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.4rem 0.75rem',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: '0.4rem',
    width: '100%',
    boxSizing: 'border-box',
    fontSize: '0.85rem',
  };

  const groupStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
    flexWrap: 'wrap',
  };

  const btnStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 8px',
    border: '1px solid #cbd5e1',
    borderRadius: '4px',
    background: '#ffffff',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#334155',
    lineHeight: 1.4,
    minHeight: '28px',
    userSelect: 'none',
  };

  const btnActiveStyle = {
    ...btnStyle,
    background: '#2563eb',
    color: '#ffffff',
    borderColor: '#1d4ed8',
  };

  const btnDisabledStyle = {
    ...btnStyle,
    opacity: 0.45,
    cursor: 'not-allowed',
  };

  const inputStyle = {
    width: '36px',
    padding: '3px 4px',
    textAlign: 'center',
    border: '1px solid #cbd5e1',
    borderRadius: '4px',
    fontSize: '0.8rem',
    color: '#1e293b',
    background: '#fff',
  };

  return (
    <div
      ref={rootContainerRef}
      className="pdf-viewer-root"
      onClick={e => e.stopPropagation()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '90%',
        maxWidth: '1200px',
        height: '88vh',
        background: '#fff',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 25px 60px -15px rgba(0,0,0,0.4)',
        border: '1px solid #e2e8f0',
        alignItems: 'stretch',
        justifyContent: 'stretch',
        color: '#1e293b',
        position: 'relative',
        ...containerStyle,
      }}
    >
      <style>{`
        .pdf-viewer-root > .react-pdf__Document {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
      `}</style>
      {/* Loading state */}
      {loading && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', fontSize: '1.1rem', color: '#64748b', fontWeight: 500 }}>
          Decoding PDF secure payload...
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="pdf-error-banner" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', color: '#b91c1c' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: 600 }}>Failed to Load PDF</h3>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>{error}</p>
        </div>
      )}

      {/* Viewer content */}
      {!loading && !error && resolvedUrl && (
        <Document
          file={resolvedUrl}
          onLoadSuccess={handleLoadSuccess}
          onLoadError={handleLoadError}
          options={{ isEvalSupported: false, enableXfa: false }}
          loading={
            <div style={{ padding: '2rem', color: '#e2e8f0', fontSize: '0.9rem', textAlign: 'center' }}>
              Loading PDF document...
            </div>
          }
        >
          {/* Main Top Toolbar */}
          <div className="pdf-viewer-toolbar" style={toolbarStyle}>
            {/* Left Group: Sidebar toggle, Page navigation, Page jump */}
            <div style={groupStyle}>
              <button
                type="button"
                className={showThumbnails ? 'active' : ''}
                style={showThumbnails ? btnActiveStyle : btnStyle}
                onClick={() => setShowThumbnails(s => !s)}
                aria-label="Toggle thumbnails sidebar"
                title="Thumbnails sidebar"
              >
                📑 Thumbnails
              </button>

              <button
                type="button"
                style={pageNumber <= 1 ? btnDisabledStyle : btnStyle}
                disabled={pageNumber <= 1}
                onClick={prevPage}
                aria-label="Previous page"
                title="Previous page"
              >
                ‹ Prev
              </button>

              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.8rem', color: '#475569' }}>
                <input
                  type="text"
                  value={pageInputVal}
                  onChange={handlePageInputChange}
                  onKeyDown={handlePageInputKeyDown}
                  onBlur={handlePageInputBlur}
                  style={inputStyle}
                  aria-label="Current page number"
                />
                <span>/ {numPages || '—'}</span>
              </div>

              <button
                type="button"
                style={pageNumber >= (numPages || 1) ? btnDisabledStyle : btnStyle}
                disabled={pageNumber >= (numPages || 1)}
                onClick={nextPage}
                aria-label="Next page"
                title="Next page"
              >
                Next ›
              </button>
            </div>

            {/* Middle Group: Zoom controls, Fit-to-width, Rotate */}
            <div style={groupStyle}>
              <button
                type="button"
                style={scale <= SCALE_MIN ? btnDisabledStyle : btnStyle}
                disabled={scale <= SCALE_MIN}
                onClick={zoomOut}
                aria-label="Zoom out"
                title="Zoom out"
              >
                −
              </button>
              <span style={{ fontSize: '0.8rem', color: '#475569', minWidth: '40px', textAlign: 'center' }}>
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                style={scale >= SCALE_MAX ? btnDisabledStyle : btnStyle}
                disabled={scale >= SCALE_MAX}
                onClick={zoomIn}
                aria-label="Zoom in"
                title="Zoom in"
              >
                +
              </button>

              <button
                type="button"
                className={fitWidth ? 'active' : ''}
                style={fitWidth ? btnActiveStyle : btnStyle}
                onClick={toggleFitWidth}
                aria-label="Fit to width"
                title="Fit to width"
              >
                ↔ Fit Width
              </button>

              <button
                type="button"
                style={btnStyle}
                onClick={rotateClockwise}
                aria-label="Rotate clockwise"
                title="Rotate 90 degrees"
              >
                ⟳ Rotate
              </button>
            </div>

            {/* Right Group: Search, Whole-document Print, Download */}
            <div style={groupStyle}>
              <button
                type="button"
                className={showSearch ? 'active' : ''}
                style={showSearch ? btnActiveStyle : btnStyle}
                onClick={() => setShowSearch(s => !s)}
                aria-label="Toggle in-document search"
                title="Search text in document"
              >
                🔍 Search
              </button>

              <button
                type="button"
                style={btnStyle}
                onClick={handlePrint}
                aria-label="Print full document"
                title="Print full PDF document"
              >
                🖨 Print
              </button>

              <a
                href={resolvedUrl}
                download={name || 'document.pdf'}
                style={{ ...btnStyle, textDecoration: 'none', background: '#0284c7', color: '#fff', borderColor: '#0369a1' }}
                aria-label="Download PDF"
                title="Download PDF"
              >
                ↓ Download
              </a>
            </div>
          </div>

          {/* Search bar row (collapsible) */}
          {showSearch && (
            <form
              onSubmit={handleSearchSubmit}
              className="pdf-search-bar"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.35rem 0.75rem',
                background: '#f1f5f9',
                borderBottom: '1px solid #e2e8f0',
                flexWrap: 'wrap',
                fontSize: '0.8rem',
              }}
            >
              <input
                type="text"
                placeholder="Find in document..."
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  executeSearch(e.target.value);
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.8rem',
                  minWidth: '180px',
                  flex: '1',
                  maxWidth: '300px',
                }}
                aria-label="Search term input"
                autoFocus
              />
              <button type="submit" style={btnStyle} aria-label="Find search term">
                Find
              </button>
              <button
                type="button"
                style={searchResults.length === 0 ? btnDisabledStyle : btnStyle}
                disabled={searchResults.length === 0}
                onClick={prevMatch}
                aria-label="Previous match"
              >
                ↑
              </button>
              <button
                type="button"
                style={searchResults.length === 0 ? btnDisabledStyle : btnStyle}
                disabled={searchResults.length === 0}
                onClick={nextMatch}
                aria-label="Next match"
              >
                ↓
              </button>
              <span className="pdf-search-count" style={{ color: '#64748b', fontSize: '0.75rem' }}>
                {searchQuery.trim()
                  ? searchResults.length > 0
                    ? `${currentMatchIndex + 1} of ${searchResults.length} matches`
                    : 'No matches found'
                  : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowSearch(false);
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                style={{ ...btnStyle, marginLeft: 'auto', padding: '2px 6px', fontSize: '0.75rem' }}
                aria-label="Close search bar"
              >
                ✕
              </button>
            </form>
          )}

          {/* Printable notification */}
          {printStatus && (
            <div style={{ padding: '0.25rem 0.5rem', background: '#dbeafe', color: '#1e40af', fontSize: '0.75rem', textAlign: 'center' }}>
              {printStatus}
            </div>
          )}

          {/* Main Viewer Body (Sidebar + Scrollable Canvas Area) */}
          <div
            ref={viewerBodyRef}
            className="pdf-viewer-body"
            style={{
              flex: 1,
              display: 'flex',
              overflow: 'hidden',
              position: 'relative',
              background: '#525659',
              width: '100%',
            }}
          >
            {/* Thumbnails Sidebar */}
            {showThumbnails && (
              <div
                className="pdf-thumbnails-sidebar"
                style={{
                  width: '140px',
                  flexShrink: 0,
                  borderRight: '1px solid #334155',
                  background: '#1e293b',
                  overflowY: 'auto',
                  padding: '8px',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
                aria-label="Page thumbnails"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 600 }}>
                    Pages ({numPages || 0})
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowThumbnails(false)}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', padding: '0 4px', lineHeight: 1 }}
                    title="Close thumbnails"
                    aria-label="Close thumbnails sidebar"
                  >
                    ✕
                  </button>
                </div>
                {Array.from(new Array(numPages || 0), (el, index) => {
                  const pNum = index + 1;
                  const isActive = pNum === pageNumber;
                  return (
                    <div
                      key={`thumb_${pNum}`}
                      className={`pdf-thumb-card ${isActive ? 'active' : ''}`}
                      onClick={() => goToPage(pNum)}
                      style={{
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '6px',
                        border: isActive ? '2px solid #38bdf8' : '1px solid #475569',
                        background: isActive ? '#0f172a' : '#334155',
                        textAlign: 'center',
                        transition: 'all 0.15s ease',
                      }}
                      title={`Go to page ${pNum}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'center', overflow: 'hidden', maxHeight: '140px' }}>
                        <Page
                          pageNumber={pNum}
                          width={110}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                          renderForms={false}
                        />
                      </div>
                      <div style={{ fontSize: '0.7rem', color: isActive ? '#38bdf8' : '#cbd5e1', marginTop: '2px', fontWeight: isActive ? 600 : 400 }}>
                        {pNum}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Scrollable Document Canvas Viewport */}
            <div
              className="pdf-scrollable-viewport"
              style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                overflow: 'auto',
                WebkitOverflowScrolling: 'touch',
                display: 'flex',
                flexDirection: 'column',
                padding: '1rem',
                boxSizing: 'border-box',
              }}
            >
              <div
                className="pdf-page-container"
                style={{
                  width: 'fit-content',
                  margin: '0 auto',
                  flexShrink: 0,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                  borderRadius: '4px',
                  background: '#fff',
                }}
              >
                <Page
                  pageNumber={pageNumber}
                  width={basePageWidth}
                  scale={scale}
                  rotate={rotation}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  renderForms={false}
                  customTextRenderer={customTextRenderer}
                />
              </div>
            </div>
          </div>

          {/* Offscreen Printable Area (Renders all pages on demand for full-document printing) */}
          {isPrinting && (
            <div className="pdf-printable-area">
              <style>{`
                @media screen {
                  .pdf-printable-area {
                    position: absolute;
                    left: -9999px;
                    top: -9999px;
                    width: 1px;
                    height: 1px;
                    overflow: hidden;
                    opacity: 0;
                  }
                }
                @media print {
                  body * { visibility: hidden !important; }
                  .pdf-printable-area, .pdf-printable-area * { visibility: visible !important; }
                  .pdf-printable-area {
                    position: absolute !important;
                    left: 0 !important;
                    top: 0 !important;
                    width: 100% !important;
                    height: auto !important;
                    display: block !important;
                    opacity: 1 !important;
                  }
                  .pdf-printable-page {
                    page-break-after: always !important;
                    break-after: page !important;
                  }
                }
              `}</style>
              {Array.from(new Array(numPages || 0), (el, index) => (
                <div key={`print_page_${index + 1}`} className="pdf-printable-page">
                  <Page
                    pageNumber={index + 1}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    renderForms={false}
                  />
                </div>
              ))}
            </div>
          )}
        </Document>
      )}
    </div>
  );
}
