import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import { SimpleLinkService, EventBus } from 'pdfjs-dist/web/pdf_viewer.mjs';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';

// Configure worker — Vite ?url import bundles the matching 6.4.299 worker as a same-origin asset
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

const SCALE_STEP = 0.25;
const SCALE_MIN = 0.5;
const SCALE_MAX = 3.0;
const DEFAULT_LINK_REL = 'noopener noreferrer nofollow';

/**
 * Safe DOM-node text highlight helper.
 * Splits raw textNode.nodeValue by search query and replaces it with a DocumentFragment
 * containing only safe TextNodes and <mark class="pdf-search-highlight"> elements
 * whose children are also TextNodes. Never parses document text as HTML.
 */
function highlightTextNodeSafely(containerEl, rawQuery) {
  if (!containerEl || !rawQuery || !rawQuery.trim()) return;
  const q = rawQuery.trim();
  const qLower = q.toLowerCase();
  const qLen = q.length;
  if (qLen === 0) return;

  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let current = walker.nextNode();
  while (current) {
    if (current.nodeValue && current.nodeValue.toLowerCase().includes(qLower)) {
      textNodes.push(current);
    }
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const raw = textNode.nodeValue;
    const rawLower = raw.toLowerCase();
    const frag = document.createDocumentFragment();
    let lastIdx = 0;
    let matchIdx = rawLower.indexOf(qLower, lastIdx);

    while (matchIdx !== -1) {
      if (matchIdx > lastIdx) {
        frag.appendChild(document.createTextNode(raw.slice(lastIdx, matchIdx)));
      }
      const mark = document.createElement('mark');
      mark.className = 'pdf-search-highlight';
      mark.appendChild(document.createTextNode(raw.slice(matchIdx, matchIdx + qLen)));
      frag.appendChild(mark);
      lastIdx = matchIdx + qLen;
      matchIdx = rawLower.indexOf(qLower, lastIdx);
    }

    if (lastIdx < raw.length) {
      frag.appendChild(document.createTextNode(raw.slice(lastIdx)));
    }

    if (textNode.parentNode) {
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }
}

/**
 * Custom LinkService extending pdfjs SimpleLinkService to handle both external links
 * (target="_blank" rel="noopener noreferrer nofollow") and internal document destinations.
 */
class ViewerLinkService extends SimpleLinkService {
  constructor(onNavigateToPage) {
    super({ eventBus: new EventBus() });
    this._onNavigateToPage = onNavigateToPage;
  }

  setDocument(pdfDocument) {
    this.pdfDocument = pdfDocument;
  }

  setNavigateCallback(cb) {
    this._onNavigateToPage = cb;
  }

  get pagesCount() {
    return this.pdfDocument ? this.pdfDocument.numPages : 0;
  }

  addLinkAttributes(link, url, newWindow) {
    link.href = url;
    link.rel = DEFAULT_LINK_REL;
    link.target = newWindow !== false ? '_blank' : '_blank';
  }

  goToDestination(dest) {
    if (!this.pdfDocument || !dest) return Promise.resolve();
    return Promise.resolve()
      .then(() => {
        if (typeof dest === 'string') {
          return this.pdfDocument.getDestination(dest);
        }
        return Array.isArray(dest) ? dest : dest;
      })
      .then((explicitDest) => {
        if (!Array.isArray(explicitDest) || explicitDest.length === 0) return;
        const destRef = explicitDest[0];
        if (typeof destRef === 'object' && destRef !== null) {
          return this.pdfDocument.getPageIndex(destRef).then((pageIndex) => {
            this.goToPage(pageIndex + 1);
          });
        } else if (typeof destRef === 'number') {
          this.goToPage(destRef + 1);
        }
      })
      .catch((err) => {
        console.warn('[PdfViewer link navigation warning]', err);
      });
  }

  goToPage(pageNumber) {
    if (this._onNavigateToPage && pageNumber >= 1 && pageNumber <= this.pagesCount) {
      this._onNavigateToPage(pageNumber);
    }
  }
}

/**
 * Direct PDF.js Page Renderer Component (Canvas + TextLayer + AnnotationLayer).
 */
function DirectPdfPage({
  pdf,
  pageNumber,
  width,
  scale = 1.0,
  rotate = 0,
  renderTextLayer = true,
  renderAnnotationLayer = true,
  searchQuery = '',
  linkService = null,
  onRenderSuccess = null,
  onRenderError = null,
  isPrintPage = false,
}) {
  const pageContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const annotationLayerRef = useRef(null);
  const [pageViewportDims, setPageViewportDims] = useState({ width: width || 600, height: Math.round((width || 600) * 1.294), effectiveScale: 1 });
  const renderKey = `${pageNumber}_${width}_${scale}_${rotate}_${searchQuery}`;
  const [renderedKey, setRenderedKey] = useState(null);
  const renderedOk = renderedKey === renderKey;

  useEffect(() => {
    if (!pdf || !pageNumber) return;

    let cancelled = false;
    let renderTask = null;
    let textLayerInstance = null;

    pdf
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) return;

        // Test hook for simulating print render error on a specific page
        if (isPrintPage && typeof window !== 'undefined' && window.__simulatePrintRenderErrorPage === pageNumber) {
          throw new Error(`Simulated print rendering failure on page ${pageNumber}`);
        }

        // Test hook for deliberately delaying printable page rendering (>700ms verification)
        if (isPrintPage && typeof window !== 'undefined' && Number(window.__printPageRenderDelayMs) > 0) {
          await new Promise((resolve) => setTimeout(resolve, Number(window.__printPageRenderDelayMs)));
          if (cancelled) return;
        }

        const effectiveRotate = (rotate !== undefined && rotate !== null ? rotate : page.rotate || 0) % 360;
        const unscaledViewport = page.getViewport({ scale: 1, rotation: effectiveRotate });
        const baseScale = width ? width / unscaledViewport.width : 1;
        const effectiveScale = baseScale * (scale || 1);
        const viewport = page.getViewport({ scale: effectiveScale, rotation: effectiveRotate });
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const renderViewport = page.getViewport({ scale: effectiveScale * dpr, rotation: effectiveRotate });

        setPageViewportDims({
          width: Math.floor(viewport.width),
          height: Math.floor(viewport.height),
          effectiveScale,
        });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d', { alpha: false });
        renderTask = page.render({
          canvasContext: ctx,
          canvas,
          viewport: renderViewport,
          annotationMode: pdfjsLib.AnnotationMode.ENABLE,
        });

        await renderTask.promise;
        if (cancelled) return;

        // Render TextLayer safely using DOM TextNodes (never interpreting PDF strings as HTML)
        if (renderTextLayer && textLayerRef.current) {
          const textContainer = textLayerRef.current;
          textContainer.innerHTML = '';
          const textContentSource = page.streamTextContent({ includeMarkedContent: true });
          textLayerInstance = new pdfjsLib.TextLayer({
            textContentSource,
            container: textContainer,
            viewport,
          });
          await textLayerInstance.render();
          if (cancelled) return;

          const endDiv = document.createElement('div');
          endDiv.className = 'endOfContent';
          textContainer.appendChild(endDiv);

          if (searchQuery && searchQuery.trim()) {
            highlightTextNodeSafely(textContainer, searchQuery);
          }
        }

        // Render AnnotationLayer for external & internal links (with renderForms: false)
        if (renderAnnotationLayer && annotationLayerRef.current && linkService) {
          const annotContainer = annotationLayerRef.current;
          annotContainer.innerHTML = '';
          const annotations = await page.getAnnotations();
          if (cancelled) return;

          const clonedViewport = viewport.clone({ dontFlip: true });
          const annotationLayer = new pdfjsLib.AnnotationLayer({
            div: annotContainer,
            accessibilityManager: null,
            annotationCanvasMap: null,
            annotationEditorUIManager: null,
            page,
            viewport: clonedViewport,
            structTreeLayer: null,
            commentManager: null,
            linkService,
            annotationStorage: pdf.annotationStorage,
          });

          await annotationLayer.render({
            viewport: clonedViewport,
            div: annotContainer,
            annotations,
            page,
            renderForms: false,
            linkService,
            annotationStorage: pdf.annotationStorage,
          });
          if (cancelled) return;

          // Ensure internal destination links carry an explicit attribute and click handler
          const allLinks = annotContainer.querySelectorAll('section.linkAnnotation a');
          annotations
            .filter((a) => a.subtype === 'Link')
            .forEach((annotData, idx) => {
              const anchor = allLinks[idx];
              if (!anchor) return;
              if (!annotData.url && (annotData.dest || annotData.action)) {
                anchor.setAttribute('data-internal-link', 'true');
                anchor.href = '#';
                anchor.addEventListener(
                  'click',
                  (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    if (annotData.dest) {
                      linkService.goToDestination(annotData.dest);
                    }
                  },
                  true
                );
              }
            });
        }

        if (!cancelled) {
          setRenderedKey(renderKey);
          if (onRenderSuccess) {
            onRenderSuccess(pageNumber);
          }
        }
      })
      .catch((err) => {
        if (cancelled || err?.name === 'RenderingCancelledException') return;
        console.error(`[DirectPdfPage render error on page ${pageNumber}]`, err);
        if (onRenderError) {
          onRenderError(pageNumber, err);
        }
      });

    return () => {
      cancelled = true;
      if (renderTask && typeof renderTask.cancel === 'function') {
        try {
          renderTask.cancel();
        } catch {
          // ignore
        }
      }
      if (textLayerInstance && typeof textLayerInstance.cancel === 'function') {
        try {
          textLayerInstance.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [pdf, pageNumber, width, scale, rotate, renderKey, renderTextLayer, renderAnnotationLayer, searchQuery, linkService, isPrintPage, onRenderSuccess, onRenderError]);

  const handleMouseDown = () => {
    if (textLayerRef.current) {
      textLayerRef.current.classList.add('selecting');
    }
  };

  const handleMouseUp = () => {
    if (textLayerRef.current) {
      textLayerRef.current.classList.remove('selecting');
    }
  };

  return (
    <div
      ref={pageContainerRef}
      className="react-pdf__Page"
      data-page-number={pageNumber}
      data-rendered={renderedOk ? 'true' : 'false'}
      style={{
        '--scale-round-x': '1px',
        '--scale-round-y': '1px',
        '--scale-factor': `${pageViewportDims.effectiveScale}`,
        '--user-unit': '1',
        '--total-scale-factor': `${pageViewportDims.effectiveScale}`,
        position: 'relative',
        width: `${pageViewportDims.width}px`,
        height: `${pageViewportDims.height}px`,
        backgroundColor: '#ffffff',
        minWidth: 'min-content',
        minHeight: 'min-content',
      }}
    >
      <canvas
        ref={canvasRef}
        className="react-pdf__Page__canvas"
        dir="ltr"
        style={{ display: 'block', userSelect: 'none' }}
      />
      {renderTextLayer && (
        <div
          ref={textLayerRef}
          className="react-pdf__Page__textContent textLayer"
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        />
      )}
      {renderAnnotationLayer && (
        <div
          ref={annotationLayerRef}
          className="react-pdf__Page__annotations annotationLayer"
        />
      )}
    </div>
  );
}

export default function PdfViewer({ url, name, containerStyle = {} }) {
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
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

  // Explicit Print Completion State Machine
  const [printPhase, setPrintPhase] = useState('idle'); // 'idle' | 'rendering' | 'printing' | 'error'
  const [printStatus, setPrintStatus] = useState('');
  const [printRenderedPages, setPrintRenderedPages] = useState({});
  const printSessionIdRef = useRef(0);
  const printTriggeredForSessionRef = useRef(0);

  // Page input jump state
  const [pageInputVal, setPageInputVal] = useState('1');

  // References
  const rootContainerRef = useRef(null);
  const viewerBodyRef = useRef(null);
  const pagesTextCacheRef = useRef(null);

  // Page navigation
  const goToPage = useCallback(
    (p) => {
      const target = Math.max(1, Math.min(numPages || 1, p));
      setPageNumber(target);
      setPageInputVal(String(target));
    },
    [numPages]
  );

  // LinkService instance
  const linkService = useMemo(() => new ViewerLinkService(null), []);
  useEffect(() => {
    linkService.setNavigateCallback(goToPage);
  }, [linkService, goToPage]);

  // Cancel any active print preparation safely
  const cancelPrintJob = useCallback((clearStatus = true) => {
    printSessionIdRef.current += 1;
    setPrintPhase('idle');
    setPrintRenderedPages({});
    if (clearStatus) {
      setPrintStatus('');
    }
    if (typeof document !== 'undefined') {
      document.body.classList.remove('pdf-printing-active');
    }
  }, []);

  // Clean up print mode on window afterprint or component unmount
  useEffect(() => {
    const handleAfterPrint = () => {
      cancelPrintJob(true);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('afterprint', handleAfterPrint);
      if (typeof document !== 'undefined') {
        document.body.classList.remove('pdf-printing-active');
      }
    };
  }, [cancelPrintJob]);

  // Resolve direct URL or custom base64 API endpoint
  useEffect(() => {
    let isMounted = true;
    pagesTextCacheRef.current = null;
    if (typeof document !== 'undefined') {
      document.body.classList.remove('pdf-printing-active');
    }
    printSessionIdRef.current += 1;

    Promise.resolve().then(() => {
      if (!isMounted) return;
      setPrintPhase('idle');
      setPrintRenderedPages({});
      setPrintStatus('');
      setPdfDoc(null);
      setNumPages(null);
      setPageNumber(1);
      setPageInputVal('1');
      setSearchResults([]);
      setCurrentMatchIndex(0);
    });

    if (!url) {
      Promise.resolve().then(() => {
        if (isMounted) {
          setResolvedUrl(null);
          setError(null);
        }
      });
      return () => {
        isMounted = false;
      };
    }

    if (url.includes('/base64')) {
      Promise.resolve().then(() => {
        if (isMounted) {
          setLoading(true);
          setError(null);
        }
      });
      let objectUrl = null;

      fetch(url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
          }
          return response.json();
        })
        .then((data) => {
          if (!isMounted) return;
          if (!data || !data.base64) {
            throw new Error('No base64 data returned from server');
          }

          const binaryString = atob(data.base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const blob = new Blob([bytes], { type: data.file_type || 'application/pdf' });
          objectUrl = URL.createObjectURL(blob);
          if (isMounted) {
            setResolvedUrl(objectUrl);
            setLoading(false);
          }
        })
        .catch((err) => {
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
  }, [url, cancelPrintJob]);

  // Load PDF document via pdfjsLib.getDocument when resolvedUrl changes
  useEffect(() => {
    if (!resolvedUrl || loading || error) return;

    let cancelled = false;
    const loadingTask = pdfjsLib.getDocument({
      url: resolvedUrl,
      isEvalSupported: false,
      enableXfa: false,
    });

    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          loadingTask.destroy().catch(() => {});
          return;
        }
        linkService.setDocument(doc);
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNumber(1);
        setPageInputVal('1');
        setError(null);

        // Pre-index text across all pages for instant whole-document search
        const cache = [];
        pagesTextCacheRef.current = null;
        const loadPromises = [];
        for (let i = 1; i <= doc.numPages; i++) {
          loadPromises.push(
            doc
              .getPage(i)
              .then((p) => p.getTextContent())
              .then((tc) => {
                cache[i] = tc.items.map((item) => item.str || '').join(' ');
              })
              .catch(() => {
                cache[i] = '';
              })
          );
        }
        Promise.all(loadPromises).then(() => {
          if (!cancelled) {
            pagesTextCacheRef.current = cache;
          }
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[PdfViewer load error]', err);
        setError(err.message || 'Failed to load PDF');
      });

    return () => {
      cancelled = true;
      loadingTask.destroy().catch(() => {});
    };
  }, [resolvedUrl, loading, error, linkService]);

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
  }, [showThumbnails, resolvedUrl, numPages, pdfDoc]);

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
    setScale((s) => Math.max(SCALE_MIN, parseFloat((s - SCALE_STEP).toFixed(2))));
  };

  const zoomIn = () => {
    setFitWidth(false);
    setScale((s) => Math.min(SCALE_MAX, parseFloat((s + SCALE_STEP).toFixed(2))));
  };

  const toggleFitWidth = () => {
    setFitWidth(true);
    setScale(1.0);
  };

  const rotateClockwise = () => {
    setRotation((r) => (r + 90) % 360);
  };

  // Search logic across all pages (literal substring matching, safe for regex metacharacters)
  const executeSearch = useCallback(
    async (query) => {
      if (!query || !query.trim()) {
        setSearchResults([]);
        setCurrentMatchIndex(0);
        return;
      }

      const q = query.trim().toLowerCase();
      let cache = pagesTextCacheRef.current;

      // If cache is still building and pdfDoc is available, build it now
      if (!cache && pdfDoc) {
        const tempCache = [];
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          try {
            const p = await pdfDoc.getPage(i);
            const tc = await p.getTextContent();
            tempCache[i] = tc.items.map((item) => item.str || '').join(' ');
          } catch {
            tempCache[i] = '';
          }
        }
        pagesTextCacheRef.current = tempCache;
        cache = tempCache;
      }

      const matches = [];
      (cache || []).forEach((text, pNum) => {
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
    },
    [goToPage, pdfDoc]
  );

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

  // Whole-document printing with explicit per-page render completion tracking
  const handlePrint = () => {
    if (!pdfDoc || !numPages) return;
    const nextSessionId = printSessionIdRef.current + 1;
    printSessionIdRef.current = nextSessionId;
    printTriggeredForSessionRef.current = 0;
    setPrintRenderedPages({});
    setPrintPhase('rendering');
    setPrintStatus(`Preparing full document for printing (0 / ${numPages} pages)...`);
    if (typeof document !== 'undefined') {
      document.body.classList.add('pdf-printing-active');
    }
  };

  const handlePrintPageSuccess = useCallback(
    (pNum) => {
      const activeSession = printSessionIdRef.current;
      setPrintRenderedPages((prev) => {
        if (printSessionIdRef.current !== activeSession) return prev;
        const next = { ...prev, [pNum]: true };
        const completedCount = Object.keys(next).length;
        if (numPages && completedCount < numPages) {
          setPrintStatus(`Preparing full document for printing (${completedCount} / ${numPages} pages)...`);
        } else if (numPages && completedCount >= numPages && printTriggeredForSessionRef.current !== activeSession) {
          printTriggeredForSessionRef.current = activeSession;
          setPrintPhase('printing');
          setPrintStatus(`Ready to print (${numPages} / ${numPages} pages rendered).`);
          requestAnimationFrame(() => {
            if (printSessionIdRef.current !== activeSession) return;
            window.print();
          });
        }
        return next;
      });
    },
    [numPages]
  );

  const handlePrintPageError = useCallback((pNum, err) => {
    printSessionIdRef.current += 1;
    setPrintPhase('error');
    setPrintRenderedPages({});
    setPrintStatus(`Print preparation failed on page ${pNum}: ${err?.message || 'Render error'}`);
    if (typeof document !== 'undefined') {
      document.body.classList.remove('pdf-printing-active');
    }
  }, []);

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

  const isPrintActive = printPhase === 'rendering' || printPhase === 'printing';

  return (
    <div
      ref={rootContainerRef}
      className="pdf-viewer-root"
      onClick={(e) => e.stopPropagation()}
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
        .textLayer mark.pdf-search-highlight {
          background-color: rgba(250, 204, 21, 0.55);
          color: transparent;
          border-radius: 2px;
          padding: 0;
          margin: 0;
        }
        @media screen {
          .pdf-printable-area {
            position: fixed;
            left: -10000px;
            top: 0;
            width: 800px;
            height: auto;
            overflow: visible;
            opacity: 0;
            pointer-events: none;
            z-index: -1;
          }
        }
        @media print {
          html, body {
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            overflow: visible !important;
            background: #ffffff !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          body.pdf-printing-active > *:not(.pdf-printable-area) {
            display: none !important;
          }
          body.pdf-printing-active > .pdf-printable-area {
            display: block !important;
            position: static !important;
            left: auto !important;
            top: auto !important;
            width: 100% !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            opacity: 1 !important;
            visibility: visible !important;
            background: #ffffff !important;
            z-index: 999999 !important;
          }
          .pdf-printable-area .pdf-printable-page {
            display: block !important;
            position: relative !important;
            page-break-after: always !important;
            break-after: page !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            margin: 0 auto !important;
            overflow: visible !important;
          }
          .pdf-printable-area .pdf-printable-page:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
        }
      `}</style>

      {/* Loading state */}
      {loading && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            fontSize: '1.1rem',
            color: '#64748b',
            fontWeight: 500,
          }}
        >
          Decoding PDF secure payload...
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          className="pdf-error-banner"
          data-testid="pdf-error-banner"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            textAlign: 'center',
            color: '#b91c1c',
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: 600 }}>Failed to Load PDF</h3>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>{error}</p>
        </div>
      )}

      {/* Viewer content */}
      {!loading && !error && resolvedUrl && (
        <div className="react-pdf__Document">
          {/* Main Top Toolbar */}
          <div className="pdf-viewer-toolbar" style={toolbarStyle}>
            {/* Left Group: Sidebar toggle, Page navigation, Page jump */}
            <div style={groupStyle}>
              <button
                type="button"
                data-testid="pdf-thumbnails-toggle"
                className={showThumbnails ? 'active' : ''}
                style={showThumbnails ? btnActiveStyle : btnStyle}
                onClick={() => setShowThumbnails((s) => !s)}
                aria-label="Toggle thumbnails sidebar"
                title="Thumbnails sidebar"
              >
                📑 Thumbnails
              </button>

              <button
                type="button"
                data-testid="pdf-prev-page"
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
                  data-testid="pdf-page-input"
                  value={pageInputVal}
                  onChange={handlePageInputChange}
                  onKeyDown={handlePageInputKeyDown}
                  onBlur={handlePageInputBlur}
                  style={inputStyle}
                  aria-label="Current page number"
                />
                <span data-testid="pdf-page-count">/ {numPages || '—'}</span>
              </div>

              <button
                type="button"
                data-testid="pdf-next-page"
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
                data-testid="pdf-zoom-out"
                style={scale <= SCALE_MIN ? btnDisabledStyle : btnStyle}
                disabled={scale <= SCALE_MIN}
                onClick={zoomOut}
                aria-label="Zoom out"
                title="Zoom out"
              >
                −
              </button>
              <span
                data-testid="pdf-zoom-level"
                style={{ fontSize: '0.8rem', color: '#475569', minWidth: '40px', textAlign: 'center' }}
              >
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                data-testid="pdf-zoom-in"
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
                data-testid="pdf-fit-width"
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
                data-testid="pdf-rotate-btn"
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
                data-testid="pdf-search-toggle"
                className={showSearch ? 'active' : ''}
                style={showSearch ? btnActiveStyle : btnStyle}
                onClick={() => setShowSearch((s) => !s)}
                aria-label="Toggle in-document search"
                title="Search text in document"
              >
                🔍 Search
              </button>

              <button
                type="button"
                data-testid="pdf-print-btn"
                style={printPhase === 'rendering' ? btnDisabledStyle : btnStyle}
                disabled={printPhase === 'rendering'}
                onClick={handlePrint}
                aria-label="Print full document"
                title="Print full PDF document"
              >
                🖨 Print
              </button>

              {isPrintActive && (
                <button
                  type="button"
                  data-testid="pdf-cancel-print-btn"
                  style={{ ...btnStyle, color: '#b91c1c', borderColor: '#fca5a5', background: '#fef2f2' }}
                  onClick={() => cancelPrintJob(true)}
                  aria-label="Cancel printing"
                  title="Cancel print preparation"
                >
                  ✕ Cancel Print
                </button>
              )}

              <a
                href={resolvedUrl}
                download={name || 'document.pdf'}
                data-testid="pdf-download-btn"
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
                data-testid="pdf-search-input"
                placeholder="Find in document..."
                value={searchQuery}
                onChange={(e) => {
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
                data-testid="pdf-search-prev"
                style={searchResults.length === 0 ? btnDisabledStyle : btnStyle}
                disabled={searchResults.length === 0}
                onClick={prevMatch}
                aria-label="Previous match"
              >
                ↑
              </button>
              <button
                type="button"
                data-testid="pdf-search-next"
                style={searchResults.length === 0 ? btnDisabledStyle : btnStyle}
                disabled={searchResults.length === 0}
                onClick={nextMatch}
                aria-label="Next match"
              >
                ↓
              </button>
              <span
                className="pdf-search-count"
                data-testid="pdf-search-count"
                style={{ color: '#64748b', fontSize: '0.75rem' }}
              >
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

          {/* Print status notification banner */}
          {printStatus && (
            <div
              className="pdf-print-status"
              data-testid="pdf-print-status"
              style={{
                padding: '0.3rem 0.6rem',
                background: printPhase === 'error' ? '#fef2f2' : '#dbeafe',
                color: printPhase === 'error' ? '#b91c1c' : '#1e40af',
                fontSize: '0.75rem',
                textAlign: 'center',
                borderBottom: '1px solid #e2e8f0',
              }}
            >
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
            {showThumbnails && pdfDoc && (
              <div
                className="pdf-thumbnails-sidebar"
                data-testid="pdf-thumbnails-sidebar"
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
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      padding: '0 4px',
                      lineHeight: 1,
                    }}
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
                      data-testid={`pdf-thumbnail-item-${pNum}`}
                      className={`pdf-thumb-card ${isActive ? 'active' : ''}`}
                      onClick={() => goToPage(pNum)}
                      style={{
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '6px',
                        border: isActive ? '2px solid #38bdf8' : '1px solid #475569',
                        background: isActive ? '#0f172a' : '#334155',
                        textAlign: 'center',
                        transition: 'border-color 0.15s ease, background-color 0.15s ease',
                      }}
                      title={`Go to page ${pNum}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'center', overflow: 'hidden', maxHeight: '140px' }}>
                        <DirectPdfPage
                          pdf={pdfDoc}
                          pageNumber={pNum}
                          width={110}
                          scale={1.0}
                          rotate={rotation}
                          renderTextLayer={false}
                          renderAnnotationLayer={false}
                        />
                      </div>
                      <div
                        style={{
                          fontSize: '0.7rem',
                          color: isActive ? '#38bdf8' : '#cbd5e1',
                          marginTop: '2px',
                          fontWeight: isActive ? 600 : 400,
                        }}
                      >
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
              {!pdfDoc ? (
                <div style={{ padding: '2rem', color: '#e2e8f0', fontSize: '0.9rem', textAlign: 'center' }}>
                  Loading PDF document...
                </div>
              ) : (
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
                  <DirectPdfPage
                    pdf={pdfDoc}
                    pageNumber={pageNumber}
                    width={basePageWidth}
                    scale={scale}
                    rotate={rotation}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    searchQuery={searchQuery}
                    linkService={linkService}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Portal Printable Area directly into document.body so parent modal height/overflow cannot clip later pages */}
          {isPrintActive &&
            pdfDoc &&
            typeof document !== 'undefined' &&
            createPortal(
              <div className="pdf-printable-area" data-testid="pdf-printable-area">
                {Array.from(new Array(numPages || 0), (el, index) => {
                  const pNum = index + 1;
                  const isPageRendered = Boolean(printRenderedPages[pNum]);
                  return (
                    <div
                      key={`print_page_${printSessionIdRef.current}_${pNum}`}
                      className="pdf-printable-page"
                      data-print-page={pNum}
                      data-print-rendered={isPageRendered ? 'true' : 'false'}
                    >
                      <DirectPdfPage
                        pdf={pdfDoc}
                        pageNumber={pNum}
                        width={720}
                        scale={1.0}
                        rotate={rotation}
                        renderTextLayer={true}
                        renderAnnotationLayer={false}
                        isPrintPage={true}
                        onRenderSuccess={handlePrintPageSuccess}
                        onRenderError={handlePrintPageError}
                      />
                    </div>
                  );
                })}
              </div>,
              document.body
            )}
        </div>
      )}
    </div>
  );
}
