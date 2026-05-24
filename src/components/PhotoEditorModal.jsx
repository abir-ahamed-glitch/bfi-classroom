import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, RotateCcw, RotateCw, Crop, Check, ZoomIn, ZoomOut,
  FlipHorizontal, FlipVertical, RefreshCcw, MessageSquare, ChevronLeft, ChevronRight
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────
   PhotoEditorModal
   Props:
     images         – array of { url, caption?, editedUrl? }
     initialIndex   – which image to open first
     onSave(newImages) – called with updated images array
     onClose()
   ───────────────────────────────────────────────────────────── */
export default function PhotoEditorModal({ images, initialIndex = 0, onSave, onClose }) {
  const [currentIdx, setCurrentIdx]   = useState(initialIndex);
  const [editedImages, setEditedImages] = useState(() =>
    images.map(img => ({ ...img }))
  );

  /* per-image editor state */
  const [rotation, setRotation]     = useState(0);
  const [flipH, setFlipH]           = useState(false);
  const [flipV, setFlipV]           = useState(false);
  const [zoom, setZoom]             = useState(1);
  const [caption, setCaption]       = useState('');
  const [cropMode, setCropMode]     = useState(false);
  // cropRect: { x,y,w,h } as % of the IMAGE (not the container)
  const [cropRect, setCropRect]     = useState(null);
  const [dragging, setDragging]     = useState(null);
  const [previewSrc, setPreviewSrc] = useState('');

  // Where the image actually renders inside the container (letterbox-aware), in px
  const [imgRenderRect, setImgRenderRectState] = useState({ left: 0, top: 0, width: 1, height: 1 });
  const imgRenderRectRef = useRef({ left: 0, top: 0, width: 1, height: 1 });
  const imgNaturalRef    = useRef({ w: 0, h: 0 });
  const setImgRenderRect = useCallback((r) => {
    imgRenderRectRef.current = r;
    setImgRenderRectState(r);
  }, []);

  const containerRef = useRef(null);
  const imgRef       = useRef(null);
  const canvasRef    = useRef(null);

  const currentImg = editedImages[currentIdx];

  /* ── Compute where the image actually renders within the container ──
     Uses object-fit:contain math + rotation bounding box to find
     the exact px rect of the image inside the container div.        ── */
  const computeImgRenderRect = useCallback(() => {
    if (!containerRef.current || !imgNaturalRef.current.w) return;
    const cW = containerRef.current.clientWidth;
    const cH = containerRef.current.clientHeight;
    if (!cW || !cH) return;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const { w: natW, h: natH } = imgNaturalRef.current;
    // Rotated bounding box (same aspect ratio as canvas bw/bh in applyEdits)
    const rotW = natW * cos + natH * sin;
    const rotH = natW * sin + natH * cos;
    // object-fit: contain
    const scale  = Math.min(cW / rotW, cH / rotH);
    const renderW = rotW * scale;
    const renderH = rotH * scale;
    setImgRenderRect({
      left:   (cW - renderW) / 2,
      top:    (cH - renderH) / 2,
      width:  renderW,
      height: renderH,
    });
  }, [rotation, setImgRenderRect]);

  /* ── Capture natural size on image load ── */
  const onImgLoad = useCallback((e) => {
    imgNaturalRef.current = { w: e.target.naturalWidth, h: e.target.naturalHeight };
    computeImgRenderRect();
  }, [computeImgRenderRect]);

  /* ── Load state whenever currentIdx changes ── */
  useEffect(() => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setZoom(1);
    setCropMode(false);
    setCropRect(null);
    setCaption(currentImg?.caption ?? '');
    setPreviewSrc(currentImg?.editedUrl ?? currentImg?.url ?? '');
    imgNaturalRef.current = { w: 0, h: 0 };
    setImgRenderRect({ left: 0, top: 0, width: 1, height: 1 });
  }, [currentIdx]); // eslint-disable-line

  /* ── Recompute render rect whenever rotation changes ── */
  useEffect(() => { computeImgRenderRect(); }, [computeImgRenderRect]);

  /* ── ResizeObserver: recompute when container size changes ── */
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(computeImgRenderRect);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [computeImgRenderRect]);

  /* ── Crop handles ── */
  const defaultCropRect = { x: 10, y: 10, w: 80, h: 80 };

  const toggleCrop = () => {
    if (cropMode) {
      setCropMode(false);
      setCropRect(null);
    } else {
      computeImgRenderRect(); // ensure fresh before opening
      setCropMode(true);
      setCropRect(defaultCropRect);
    }
  };

  /* ── Pointer events — coordinates stored as IMAGE-relative % ── */
  const onPointerDown = useCallback((e, handle) => {
    if (!cropMode || !cropRect) return;
    e.preventDefault();
    const cRect = containerRef.current?.getBoundingClientRect();
    if (!cRect) return;
    const ir = imgRenderRectRef.current;
    // Convert pointer → image-relative %
    const sx = ((e.clientX - cRect.left - ir.left) / ir.width)  * 100;
    const sy = ((e.clientY - cRect.top  - ir.top)  / ir.height) * 100;
    setDragging({ handle, sx, sy, ox: cropRect.x, oy: cropRect.y, ow: cropRect.w, oh: cropRect.h });
  }, [cropMode, cropRect]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const cRect = containerRef.current?.getBoundingClientRect();
      if (!cRect) return;
      const ir = imgRenderRectRef.current; // always fresh via ref, not stale closure
      const cx = ((e.clientX - cRect.left - ir.left) / ir.width)  * 100;
      const cy = ((e.clientY - cRect.top  - ir.top)  / ir.height) * 100;
      const dx = cx - dragging.sx;
      const dy = cy - dragging.sy;

      setCropRect(prev => {
        let { x, y, w, h } = { ...prev };
        const { handle, ox, oy, ow, oh } = dragging;
        const MIN = 5;

        if (handle === 'body') {
          x = Math.max(0, Math.min(100 - ow, ox + dx));
          y = Math.max(0, Math.min(100 - oh, oy + dy));
        } else {
          if (handle.includes('e')) { w = Math.max(MIN, Math.min(100 - ox, ow + dx)); }
          if (handle.includes('w')) {
            const nw = Math.max(MIN, ow - dx);
            const nx = Math.max(0, ox + (ow - nw));
            x = nx; w = nw;
          }
          if (handle.includes('s')) { h = Math.max(MIN, Math.min(100 - oy, oh + dy)); }
          if (handle.includes('n')) {
            const nh = Math.max(MIN, oh - dy);
            const ny = Math.max(0, oy + (oh - nh));
            y = ny; h = nh;
          }
        }
        return { x, y, w, h };
      });
    };
    const onUp = () => setDragging(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [dragging]);

  /* ── Apply edits → canvas ── */
  const applyEdits = useCallback(() => {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      const src = currentImg.editedUrl ?? currentImg.url;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const rad = (rotation * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rad));
        const sin = Math.abs(Math.sin(rad));

        /* Bounding box after rotation */
        const bw = img.naturalWidth * cos + img.naturalHeight * sin;
        const bh = img.naturalWidth * sin + img.naturalHeight * cos;

        canvas.width  = Math.round(bw);
        canvas.height = Math.round(bh);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(rad);
        ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        ctx.restore();

        /* Crop — cropRect is IMAGE-relative %, maps directly to canvas pixels */
        if (cropRect) {
          const cx = Math.max(0, Math.round((cropRect.x / 100) * canvas.width));
          const cy = Math.max(0, Math.round((cropRect.y / 100) * canvas.height));
          const cw = Math.min(Math.round((cropRect.w / 100) * canvas.width),  canvas.width  - cx);
          const ch = Math.min(Math.round((cropRect.h / 100) * canvas.height), canvas.height - cy);

          if (cw > 0 && ch > 0) {
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width  = cw;
            cropCanvas.height = ch;
            cropCanvas.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);
            resolve(cropCanvas.toDataURL('image/jpeg', 0.92));
          } else {
            resolve(canvas.toDataURL('image/jpeg', 0.92));
          }
        } else {
          resolve(canvas.toDataURL('image/jpeg', 0.92));
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }, [currentImg, rotation, flipH, flipV, cropRect]);

  /* ── Save current photo ── */
  const saveCurrent = async () => {
    const dataUrl = await applyEdits();
    setEditedImages(prev => {
      const next = [...prev];
      next[currentIdx] = { ...next[currentIdx], editedUrl: dataUrl, caption };
      return next;
    });
    setPreviewSrc(dataUrl);
    setCropMode(false);
    setCropRect(null);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
  };

  /* ── Confirm all & return ── */
  const handleDone = async () => {
    // Auto-save current if there are unsaved transforms
    const hasUnsaved = rotation !== 0 || flipH || flipV || cropRect;
    let finalImages = editedImages;
    if (hasUnsaved) {
      const dataUrl = await applyEdits();
      finalImages = editedImages.map((img, i) =>
        i === currentIdx ? { ...img, editedUrl: dataUrl, caption } : img
      );
    } else {
      finalImages = editedImages.map((img, i) =>
        i === currentIdx ? { ...img, caption } : img
      );
    }
    onSave(finalImages);
  };

  /* ── Reset ── */
  const resetCurrent = () => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setZoom(1);
    setCropMode(false);
    setCropRect(null);
    setPreviewSrc(currentImg.url); // original
    setEditedImages(prev => {
      const next = [...prev];
      next[currentIdx] = { ...next[currentIdx], editedUrl: undefined };
      return next;
    });
  };

  const isDark = !document.documentElement.getAttribute('data-mode') || 
                  document.documentElement.getAttribute('data-mode') !== 'light';

  const navTo = (dir) => {
    const next = currentIdx + dir;
    if (next < 0 || next >= editedImages.length) return;
    setCurrentIdx(next);
  };

  const imgTransform = [
    `rotate(${rotation}deg)`,
    `scale(${zoom})`,
    flipH ? 'scaleX(-1)' : '',
    flipV ? 'scaleY(-1)' : '',
  ].filter(Boolean).join(' ');

  /* ─── RENDER ─── */
  return createPortal(
    <div
      className="photo-editor-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="photo-editor-shell">
        {/* ── Header ── */}
        <div className="photo-editor-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg,var(--accent-primary),#b91c1c)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Crop size={18} color="#fff" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>Edit Photo</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Photo {currentIdx + 1} of {editedImages.length}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button className="pe-btn pe-btn-primary" onClick={handleDone}>
              <Check size={15} /> Done
            </button>
            <button className="pe-btn pe-btn-ghost" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="photo-editor-body">

          {/* ── Left: Thumbnail strip ── */}
          {editedImages.length > 1 && (
            <div className="photo-editor-strip">
              {editedImages.map((img, i) => (
                <div
                  key={i}
                  className={`pe-strip-thumb ${i === currentIdx ? 'active' : ''}`}
                  onClick={() => setCurrentIdx(i)}
                >
                  <img
                    src={img.editedUrl ?? img.url}
                    alt={`Photo ${i + 1}`}
                  />
                  {img.editedUrl && (
                    <div className="pe-strip-edited-badge">✓</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Center: Canvas area ── */}
          <div className="photo-editor-canvas-area">
            {/* Nav arrows */}
            {currentIdx > 0 && (
              <button className="pe-nav-arrow pe-nav-arrow--left" onClick={() => navTo(-1)}>
                <ChevronLeft size={22} />
              </button>
            )}
            {currentIdx < editedImages.length - 1 && (
              <button className="pe-nav-arrow pe-nav-arrow--right" onClick={() => navTo(1)}>
                <ChevronRight size={22} />
              </button>
            )}

            {/* Image container with crop overlay */}
            <div
              ref={containerRef}
              className="pe-image-container"
              style={{ cursor: cropMode ? (dragging ? 'grabbing' : 'default') : 'default' }}
            >
              <img
                ref={imgRef}
                src={previewSrc}
                alt="Edit preview"
                className="pe-preview-img"
                style={{ transform: imgTransform, transformOrigin: 'center center' }}
                draggable={false}
                onLoad={onImgLoad}
              />

              {/* Crop overlay — uses container-px coords derived from image-relative % */}
              {cropMode && cropRect && (() => {
                const ir = imgRenderRect;
                const bL = ir.left   + (cropRect.x / 100) * ir.width;
                const bT = ir.top    + (cropRect.y / 100) * ir.height;
                const bW = (cropRect.w / 100) * ir.width;
                const bH = (cropRect.h / 100) * ir.height;
                return (
                  <div className="pe-crop-overlay" style={{ position: 'absolute', inset: 0 }}>
                    {/* SVG: darkening + rule-of-thirds grid + border */}
                    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                      <defs>
                        <mask id="crop-mask">
                          <rect width="100%" height="100%" fill="white" />
                          <rect x={bL} y={bT} width={bW} height={bH} fill="black" />
                        </mask>
                      </defs>
                      {/* Dark outside */}
                      <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#crop-mask)" />
                      {/* Rule-of-thirds grid */}
                      <line x1={bL + bW/3}   y1={bT} x2={bL + bW/3}   y2={bT+bH} stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
                      <line x1={bL + 2*bW/3} y1={bT} x2={bL + 2*bW/3} y2={bT+bH} stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
                      <line x1={bL} y1={bT + bH/3}   x2={bL+bW} y2={bT + bH/3}   stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
                      <line x1={bL} y1={bT + 2*bH/3} x2={bL+bW} y2={bT + 2*bH/3} stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
                      {/* Crop border */}
                      <rect x={bL} y={bT} width={bW} height={bH} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5"/>
                    </svg>

                    {/* Draggable/resizable crop box (px-positioned) */}
                    <div
                      className="pe-crop-box"
                      style={{ position: 'absolute', left: bL, top: bT, width: bW, height: bH }}
                      onPointerDown={e => onPointerDown(e, 'body')}
                    >
                      {/* Corner & edge handles */}
                      {['nw','n','ne','e','se','s','sw','w'].map(h => (
                        <div
                          key={h}
                          className={`pe-crop-handle pe-crop-handle--${h}`}
                          onPointerDown={e => { e.stopPropagation(); onPointerDown(e, h); }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Caption below image */}
            <div className="pe-caption-area">
              <MessageSquare size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Add a caption…"
                value={caption}
                onChange={e => setCaption(e.target.value)}
                className="pe-caption-input"
                maxLength={200}
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                {caption.length}/200
              </span>
            </div>
          </div>

          {/* ── Right: Controls panel ── */}
          <div className="photo-editor-controls">

            {/* Rotation */}
            <div className="pe-control-section">
              <div className="pe-section-label">Rotate &amp; Flip</div>
              <div className="pe-control-row">
                <button
                  className="pe-tool-btn"
                  onClick={() => setRotation(r => r - 90)}
                  title="Rotate left 90°"
                >
                  <RotateCcw size={18} />
                  <span>Left</span>
                </button>
                <button
                  className="pe-tool-btn"
                  onClick={() => setRotation(r => r + 90)}
                  title="Rotate right 90°"
                >
                  <RotateCw size={18} />
                  <span>Right</span>
                </button>
                <button
                  className={`pe-tool-btn ${flipH ? 'active' : ''}`}
                  onClick={() => setFlipH(v => !v)}
                  title="Flip horizontal"
                >
                  <FlipHorizontal size={18} />
                  <span>Flip H</span>
                </button>
                <button
                  className={`pe-tool-btn ${flipV ? 'active' : ''}`}
                  onClick={() => setFlipV(v => !v)}
                  title="Flip vertical"
                >
                  <FlipVertical size={18} />
                  <span>Flip V</span>
                </button>
              </div>
              {/* Fine-grained rotation slider */}
              <div className="pe-slider-row">
                <span className="pe-slider-label">Angle: {rotation}°</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={rotation}
                  onChange={e => setRotation(Number(e.target.value))}
                  className="pe-range"
                />
              </div>
            </div>

            {/* Zoom */}
            <div className="pe-control-section">
              <div className="pe-section-label">Zoom</div>
              <div className="pe-control-row">
                <button
                  className="pe-tool-btn"
                  onClick={() => setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(1)))}
                  title="Zoom out"
                >
                  <ZoomOut size={18} />
                  <span>Out</span>
                </button>
                <button
                  className="pe-tool-btn"
                  onClick={() => setZoom(z => Math.min(3, +(z + 0.1).toFixed(1)))}
                  title="Zoom in"
                >
                  <ZoomIn size={18} />
                  <span>In</span>
                </button>
              </div>
              <div className="pe-slider-row">
                <span className="pe-slider-label">Zoom: {(zoom * 100).toFixed(0)}%</span>
                <input
                  type="range"
                  min={50}
                  max={300}
                  step={5}
                  value={Math.round(zoom * 100)}
                  onChange={e => setZoom(e.target.value / 100)}
                  className="pe-range"
                />
              </div>
            </div>

            {/* Crop */}
            <div className="pe-control-section">
              <div className="pe-section-label">Crop</div>
              <button
                className={`pe-tool-btn pe-tool-btn--full ${cropMode ? 'active' : ''}`}
                onClick={toggleCrop}
              >
                <Crop size={18} />
                <span>{cropMode ? 'Cancel Crop' : 'Enable Crop'}</span>
              </button>
              {cropMode && (
                <p className="pe-crop-hint">
                  Drag the box to reposition • Drag corners/edges to resize
                </p>
              )}
            </div>

            {/* Apply & Reset */}
            <div className="pe-control-section pe-control-section--actions">
              <button className="pe-btn pe-btn-primary pe-btn--full" onClick={saveCurrent}>
                <Check size={15} /> Apply to This Photo
              </button>
              <button className="pe-btn pe-btn-ghost pe-btn--full" onClick={resetCurrent}>
                <RefreshCcw size={15} /> Reset Original
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* Hidden canvas for rendering */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <style>{`
        /* ══ Overlay ══ */
        .photo-editor-overlay {
          position: fixed;
          inset: 0;
          z-index: 99999;
          background: rgba(0,0,0,0.82);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: pe-fade-in 0.22s ease;
        }
        @keyframes pe-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* ══ Shell ══ */
        .photo-editor-shell {
          width: min(1100px, 96vw);
          height: min(88vh, 760px);
          display: flex;
          flex-direction: column;
          border-radius: 20px;
          overflow: hidden;
          background: var(--bg-secondary, #0f1623);
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 32px 80px rgba(0,0,0,0.7);
          animation: pe-slide-up 0.28s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes pe-slide-up {
          from { transform: translateY(30px) scale(0.97); opacity: 0; }
          to   { transform: translateY(0) scale(1);       opacity: 1; }
        }

        /* ══ Header ══ */
        .photo-editor-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.9rem 1.25rem;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          background: rgba(255,255,255,0.025);
          flex-shrink: 0;
        }

        /* ══ Body ══ */
        .photo-editor-body {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        /* ══ Strip ══ */
        .photo-editor-strip {
          width: 90px;
          flex-shrink: 0;
          overflow-y: auto;
          background: rgba(0,0,0,0.2);
          border-right: 1px solid rgba(255,255,255,0.06);
          padding: 0.75rem 0.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .pe-strip-thumb {
          width: 100%;
          aspect-ratio: 1;
          border-radius: 8px;
          overflow: hidden;
          cursor: pointer;
          border: 2px solid transparent;
          transition: border-color 0.2s, transform 0.15s;
          position: relative;
        }
        .pe-strip-thumb img {
          width: 100%; height: 100%; object-fit: cover;
        }
        .pe-strip-thumb.active {
          border-color: var(--accent-primary);
          transform: scale(1.04);
        }
        .pe-strip-thumb:hover:not(.active) {
          border-color: rgba(255,255,255,0.25);
        }
        .pe-strip-edited-badge {
          position: absolute;
          bottom: 3px; right: 3px;
          background: var(--accent-primary);
          color: #fff;
          font-size: 0.6rem;
          font-weight: 700;
          border-radius: 4px;
          padding: 1px 4px;
        }

        /* ══ Canvas area ══ */
        .photo-editor-canvas-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.75rem;
          padding: 1rem 1.25rem;
          background: rgba(0,0,0,0.15);
          position: relative;
          overflow: hidden;
        }

        /* ══ Image container ══ */
        .pe-image-container {
          position: relative;
          width: 100%;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 12px;
          background: rgba(0,0,0,0.25);
          min-height: 0;
        }
        .pe-preview-img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          display: block;
          user-select: none;
          pointer-events: none;
          transition: transform 0.25s ease;
        }

        /* ══ Caption ══ */
        .pe-caption-area {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          padding: 0.45rem 0.75rem;
          flex-shrink: 0;
        }
        .pe-caption-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary, #f1f5f9);
          font-size: 0.85rem;
          font-family: inherit;
        }
        .pe-caption-input::placeholder { color: var(--text-muted, #64748b); }

        /* ══ Nav arrows ══ */
        .pe-nav-arrow {
          position: absolute;
          top: 50%; transform: translateY(-50%);
          background: rgba(0,0,0,0.55);
          border: 1px solid rgba(255,255,255,0.12);
          color: #fff;
          border-radius: 50%;
          width: 38px; height: 38px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          z-index: 10;
          transition: background 0.2s;
        }
        .pe-nav-arrow:hover { background: rgba(0,0,0,0.75); }
        .pe-nav-arrow--left  { left: 8px; }
        .pe-nav-arrow--right { right: 8px; }

        /* ══ Controls panel ══ */
        .photo-editor-controls {
          width: 200px;
          flex-shrink: 0;
          overflow-y: auto;
          border-left: 1px solid rgba(255,255,255,0.06);
          padding: 1rem 0.85rem;
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
        }
        .pe-control-section {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          padding-bottom: 0.85rem;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .pe-control-section:last-child { border-bottom: none; }
        .pe-control-section--actions { margin-top: auto; gap: 0.5rem; }
        .pe-section-label {
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-muted, #64748b);
          margin-bottom: 0.25rem;
        }
        .pe-control-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.35rem;
        }
        .pe-tool-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
          padding: 0.5rem 0.25rem;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px;
          color: var(--text-secondary, #94a3b8);
          font-size: 0.65rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s, color 0.2s, border-color 0.2s;
          font-family: inherit;
        }
        .pe-tool-btn:hover {
          background: rgba(255,255,255,0.1);
          color: var(--text-primary, #f1f5f9);
          border-color: rgba(255,255,255,0.18);
        }
        .pe-tool-btn.active {
          background: rgba(225,29,72,0.18);
          color: var(--accent-primary, #e11d48);
          border-color: rgba(225,29,72,0.4);
        }
        .pe-tool-btn--full {
          grid-column: span 2;
          flex-direction: row;
          padding: 0.55rem 0.75rem;
          gap: 0.4rem;
          font-size: 0.75rem;
          justify-content: center;
        }
        .pe-slider-row {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .pe-slider-label {
          font-size: 0.7rem;
          color: var(--text-muted, #64748b);
          text-align: right;
        }
        .pe-range {
          width: 100%;
          accent-color: var(--accent-primary, #e11d48);
          cursor: pointer;
        }
        .pe-crop-hint {
          font-size: 0.68rem;
          color: var(--text-muted, #64748b);
          line-height: 1.4;
          margin: 0;
          padding: 0.3rem 0.5rem;
          background: rgba(255,255,255,0.03);
          border-radius: 6px;
          border-left: 2px solid var(--accent-primary, #e11d48);
        }

        /* ══ Buttons ══ */
        .pe-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          padding: 0.45rem 0.9rem;
          border-radius: 8px;
          font-size: 0.82rem;
          font-weight: 600;
          cursor: pointer;
          border: none;
          font-family: inherit;
          transition: opacity 0.2s, transform 0.15s;
        }
        .pe-btn:hover { opacity: 0.88; transform: translateY(-1px); }
        .pe-btn-primary {
          background: var(--accent-primary, #e11d48);
          color: #fff;
          box-shadow: 0 4px 14px rgba(225,29,72,0.35);
        }
        .pe-btn-ghost {
          background: rgba(255,255,255,0.08);
          color: var(--text-secondary, #94a3b8);
          border: 1px solid rgba(255,255,255,0.1);
        }
        .pe-btn--full { width: 100%; }

        /* ══ Crop overlay ══ */
        .pe-crop-box {
          position: absolute;
          cursor: grab;
          box-shadow: 0 0 0 9999px transparent;
          outline: 2px solid rgba(255,255,255,0.85);
          outline-offset: -1px;
        }
        .pe-crop-box:active { cursor: grabbing; }
        .pe-crop-grid {
          position: absolute;
          inset: 0;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          grid-template-rows: 1fr 1fr 1fr;
          pointer-events: none;
        }
        .pe-crop-grid > div {
          border: 1px solid rgba(255,255,255,0.2);
        }
        .pe-crop-handle {
          position: absolute;
          width: 14px;
          height: 14px;
          background: #fff;
          border: 2px solid var(--accent-primary, #e11d48);
          border-radius: 50%;
          z-index: 20;
        }
        .pe-crop-handle--nw { top:-7px; left:-7px;   cursor: nwse-resize; }
        .pe-crop-handle--n  { top:-7px; left:calc(50% - 7px); cursor: ns-resize; }
        .pe-crop-handle--ne { top:-7px; right:-7px;  cursor: nesw-resize; }
        .pe-crop-handle--e  { top:calc(50% - 7px); right:-7px; cursor: ew-resize; }
        .pe-crop-handle--se { bottom:-7px; right:-7px; cursor: nwse-resize; }
        .pe-crop-handle--s  { bottom:-7px; left:calc(50% - 7px); cursor: ns-resize; }
        .pe-crop-handle--sw { bottom:-7px; left:-7px;  cursor: nesw-resize; }
        .pe-crop-handle--w  { top:calc(50% - 7px); left:-7px; cursor: ew-resize; }

        /* ══ Light mode ══ */
        [data-mode="light"] .photo-editor-shell {
          background: #ffffff;
          border-color: rgba(0,0,0,0.12);
        }
        [data-mode="light"] .photo-editor-header {
          background: #f8fafc;
          border-color: rgba(0,0,0,0.09);
        }
        [data-mode="light"] .photo-editor-strip {
          background: #f1f5f9;
          border-color: rgba(0,0,0,0.08);
        }
        [data-mode="light"] .photo-editor-controls {
          border-color: rgba(0,0,0,0.08);
        }
        [data-mode="light"] .pe-tool-btn {
          background: rgba(0,0,0,0.04);
          border-color: rgba(0,0,0,0.1);
          color: #475569;
        }
        [data-mode="light"] .pe-tool-btn:hover {
          background: rgba(0,0,0,0.08);
          color: #0f172a;
        }
        [data-mode="light"] .pe-caption-area {
          background: rgba(0,0,0,0.03);
          border-color: rgba(0,0,0,0.09);
        }
        [data-mode="light"] .pe-caption-input { color: #0f172a; }
        [data-mode="light"] .pe-btn-ghost {
          background: rgba(0,0,0,0.06);
          color: #475569;
          border-color: rgba(0,0,0,0.12);
        }
        [data-mode="light"] .pe-image-container {
          background: rgba(0,0,0,0.06);
        }

        /* ══ Responsive ══ */
        @media (max-width: 700px) {
          .photo-editor-shell { height: 95vh; border-radius: 14px 14px 0 0; }
          .photo-editor-strip { display: none; }
          .photo-editor-controls { width: 150px; }
        }
      `}</style>
    </div>,
    document.body
  );
}
