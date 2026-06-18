import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

export default function ImageViewerModal({ imageViewer, setImageViewer, allImages }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  useEffect(() => {
    // Reset zoom and pan when image changes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoom(1);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPan({ x: 0, y: 0 });
  }, [imageViewer?.id]);

  const currentIndex = allImages?.findIndex(img => img.id === imageViewer?.id) ?? -1;
  const hasMultiple = allImages && allImages.length > 1 && currentIndex !== -1;

  const handlePrev = (e) => {
    e.stopPropagation();
    if (hasMultiple && currentIndex > 0) {
      setImageViewer(allImages[currentIndex - 1]);
    }
  };

  const handleNext = (e) => {
    e.stopPropagation();
    if (hasMultiple && currentIndex < allImages.length - 1) {
      setImageViewer(allImages[currentIndex + 1]);
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    setZoom(prevZoom => {
      // Sensitivity of zoom
      const zoomFactor = 0.05;
      const delta = e.deltaY > 0 ? -zoomFactor : zoomFactor;
      const newZoom = Math.max(0.5, Math.min(prevZoom + delta, 5));
      
      // If zooming out to 1, reset pan
      if (newZoom <= 1) {
        setPan({ x: 0, y: 0 });
      }
      return newZoom;
    });
  };

  const handleMouseDown = (e) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging && zoom > 1) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('mousemove', handleMouseMove);
    } else {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousemove', handleMouseMove);
    }
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isDragging, dragStart, zoom]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setImageViewer(null);
      } else if (e.key === 'ArrowLeft') {
        if (hasMultiple && currentIndex > 0) {
          setImageViewer(allImages[currentIndex - 1]);
        }
      } else if (e.key === 'ArrowRight') {
        if (hasMultiple && currentIndex < allImages.length - 1) {
          setImageViewer(allImages[currentIndex + 1]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasMultiple, currentIndex, allImages, setImageViewer]);

  const filmstripRef = useRef(null);

  useEffect(() => {
    if (filmstripRef.current && hasMultiple && currentIndex !== -1) {
      // +1 to account for the <style> tag which is the first child
      const selectedThumb = filmstripRef.current.children[currentIndex + 1];
      if (selectedThumb) {
        selectedThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [currentIndex, hasMultiple]);

  if (!imageViewer || typeof document === 'undefined') return null;

  return createPortal(
    <div 
      className="image-viewer-overlay" 
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden'
      }}
    >
      <div 
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setImageViewer(null);
          }
        }}
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{ 
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' 
        }}
      >
        {/* Top Controls (Close & Download could go here, for now just close) */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '60px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '0 20px', zIndex: 20 }}>
          <button 
            type="button" 
            onClick={() => setImageViewer(null)} 
            aria-label="Close image viewer" 
            style={{ 
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: 'white',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          >
            <X size={24} />
          </button>
        </div>

        {/* Previous Button */}
        {hasMultiple && currentIndex > 0 && (
          <button 
            type="button" 
            onClick={handlePrev} 
            aria-label="Previous image" 
            style={{ 
              zIndex: 20, 
              position: 'absolute', 
              left: '20px', 
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'rgba(255,255,255,0.1)', 
              color: 'white', 
              border: 'none', 
              borderRadius: '50%', 
              padding: '12px', 
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          >
            <ChevronLeft size={32} />
          </button>
        )}

        {/* Main Image */}
        <img 
          key={imageViewer?.id}
          src={imageViewer?.src} 
          alt={imageViewer?.alt || 'Viewed Image'} 
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            userSelect: 'none',
            WebkitUserDrag: 'none',
            boxShadow: 'none',
            background: 'transparent'
          }}
        />

        {/* Caption */}
        {imageViewer?.caption && (
          <div 
            style={{ 
              zIndex: 20,
              position: 'absolute',
              bottom: hasMultiple ? '100px' : '40px',
              color: 'white',
              background: 'rgba(0,0,0,0.6)',
              padding: '8px 16px',
              borderRadius: '20px',
              maxWidth: '80%',
              textAlign: 'center',
              backdropFilter: 'blur(4px)'
            }}
          >
            {imageViewer.caption}
          </div>
        )}

        {/* Next Button */}
        {hasMultiple && currentIndex < allImages.length - 1 && (
          <button 
            type="button" 
            onClick={handleNext} 
            aria-label="Next image" 
            style={{ 
              zIndex: 20, 
              position: 'absolute', 
              right: '20px', 
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'rgba(255,255,255,0.1)', 
              color: 'white', 
              border: 'none', 
              borderRadius: '50%', 
              padding: '12px', 
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          >
            <ChevronRight size={32} />
          </button>
        )}

        {/* Filmstrip */}
        {hasMultiple && (
          <div 
            ref={filmstripRef}
            style={{
              position: 'absolute',
              bottom: '10px',
              left: '50%',
              transform: 'translateX(-50%)',
              maxWidth: '90%',
              zIndex: 20,
              display: 'flex',
              overflowX: 'auto',
              gap: '8px',
              padding: '8px',
              background: 'rgba(0,0,0,0.6)',
              borderRadius: '12px',
              backdropFilter: 'blur(10px)',
              // Hide scrollbar but keep functionality
              msOverflowStyle: 'none',
              scrollbarWidth: 'none',
            }}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              // Prevent zooming when scrolling on the filmstrip
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              // Prevent panning when clicking on the filmstrip
              e.stopPropagation();
            }}
            className="image-viewer-filmstrip-container"
          >
            <style>
              {`
                .image-viewer-filmstrip-container::-webkit-scrollbar {
                  display: none;
                }
              `}
            </style>
            {allImages.map((img, idx) => {
              const isSelected = currentIndex === idx;
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setImageViewer(img)}
                  style={{
                    padding: 0,
                    margin: 0,
                    border: isSelected ? '2px solid #0084ff' : '2px solid transparent',
                    background: 'none',
                    flexShrink: 0,
                    cursor: 'pointer',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    opacity: isSelected ? 1 : 0.5,
                    transition: 'all 0.2s',
                    width: '48px',
                    height: '48px'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.opacity = '0.5';
                  }}
                >
                  <img 
                    src={img.src}
                    alt={img.alt || 'Thumbnail'}
                    style={{
                      height: '100%',
                      width: '100%',
                      objectFit: 'cover',
                      display: 'block'
                    }}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
