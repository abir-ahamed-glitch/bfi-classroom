import './SkeletonLoader.css';

/**
 * SkeletonLoader — Shimmer placeholder component
 *
 * Renders animated skeleton placeholders that match the shape of content
 * being loaded. Provides a much better perceived-performance than spinners.
 *
 * @param {'text'|'circle'|'card'|'avatar'|'paragraph'|'list'|'inbox'|'dashboard'} variant
 * @param {number} count - Number of skeleton items to render (for list/paragraph)
 * @param {string} className - Additional CSS class
 */
export default function SkeletonLoader({ variant = 'text', count = 1, className = '' }) {
  const items = Array.from({ length: count });

  switch (variant) {
    case 'circle':
      return (
        <div className={`skeleton-wrapper ${className}`}>
          {items.map((_, i) => (
            <div key={i} className="skeleton skeleton-circle" />
          ))}
        </div>
      );

    case 'avatar':
      return (
        <div className={`skeleton-wrapper skeleton-row ${className}`}>
          <div className="skeleton skeleton-avatar" />
          <div className="skeleton-col" style={{ flex: 1 }}>
            <div className="skeleton skeleton-text" style={{ width: '60%' }} />
            <div className="skeleton skeleton-text skeleton-text-sm" style={{ width: '40%' }} />
          </div>
        </div>
      );

    case 'card':
      return (
        <div className={`skeleton-wrapper ${className}`}>
          {items.map((_, i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton skeleton-card-image" />
              <div className="skeleton-card-body">
                <div className="skeleton skeleton-text" style={{ width: '80%' }} />
                <div className="skeleton skeleton-text skeleton-text-sm" style={{ width: '55%' }} />
              </div>
            </div>
          ))}
        </div>
      );

    case 'paragraph':
      return (
        <div className={`skeleton-wrapper skeleton-col ${className}`}>
          {items.map((_, i) => (
            <div key={i} className="skeleton skeleton-text" style={{ width: `${85 - (i % 3) * 15}%` }} />
          ))}
        </div>
      );

    case 'list':
      return (
        <div className={`skeleton-wrapper skeleton-col ${className}`}>
          {items.map((_, i) => (
            <div key={i} className="skeleton-list-item">
              <div className="skeleton skeleton-avatar" />
              <div className="skeleton-col" style={{ flex: 1, gap: '0.35rem' }}>
                <div className="skeleton skeleton-text" style={{ width: `${70 + (i % 3) * 10}%` }} />
                <div className="skeleton skeleton-text skeleton-text-sm" style={{ width: `${40 + (i % 2) * 20}%` }} />
              </div>
            </div>
          ))}
        </div>
      );

    case 'inbox':
      return (
        <div className={`skeleton-wrapper skeleton-col ${className}`} style={{ padding: '1rem', gap: '0.5rem' }}>
          {items.map((_, i) => (
            <div key={i} className="skeleton-list-item" style={{ padding: '0.9rem', borderRadius: '14px' }}>
              <div className="skeleton skeleton-avatar" style={{ width: 44, height: 44 }} />
              <div className="skeleton-col" style={{ flex: 1, gap: '0.4rem' }}>
                <div className="skeleton-row" style={{ justifyContent: 'space-between' }}>
                  <div className="skeleton skeleton-text" style={{ width: '45%', height: 14 }} />
                  <div className="skeleton skeleton-text" style={{ width: '20%', height: 10 }} />
                </div>
                <div className="skeleton skeleton-text skeleton-text-sm" style={{ width: '70%' }} />
              </div>
            </div>
          ))}
        </div>
      );

    case 'dashboard':
      return (
        <div className={`skeleton-wrapper skeleton-col ${className}`} style={{ padding: '1.5rem', gap: '1.5rem' }}>
          {/* Stats row */}
          <div className="skeleton-row" style={{ gap: '1rem' }}>
            {[1, 2, 3].map(n => (
              <div key={n} className="skeleton-stat-card">
                <div className="skeleton skeleton-text" style={{ width: '50%', height: 12 }} />
                <div className="skeleton skeleton-text" style={{ width: '30%', height: 24 }} />
              </div>
            ))}
          </div>
          {/* Content cards */}
          <div className="skeleton skeleton-text" style={{ width: '35%', height: 18 }} />
          <div className="skeleton-row" style={{ gap: '1rem', flexWrap: 'wrap' }}>
            {[1, 2, 3, 4].map(n => (
              <div key={n} className="skeleton-card" style={{ flex: '1 1 calc(50% - 0.5rem)', minWidth: 200 }}>
                <div className="skeleton skeleton-card-image" />
                <div className="skeleton-card-body">
                  <div className="skeleton skeleton-text" style={{ width: '75%' }} />
                  <div className="skeleton skeleton-text skeleton-text-sm" style={{ width: '50%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    default: // 'text'
      return (
        <div className={`skeleton-wrapper ${className}`}>
          {items.map((_, i) => (
            <div key={i} className="skeleton skeleton-text" />
          ))}
        </div>
      );
  }
}
