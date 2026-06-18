import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import './GifPicker.css';

const TENOR_API_KEY = 'LIVDSRZULELA';
const GIF_CATEGORIES = ['Trending', 'Happy', 'Funny', 'Love', 'Wow', 'Clap', 'Sad', 'Film', 'Good Morning', 'Thank You'];

export default function GifPicker({ onSelect, onClose }) {
  const [gifs, setGifs] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('Trending');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pickerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const fetchGifs = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = searchQuery.trim() || (activeCategory === 'Trending' ? '' : activeCategory);
        const endpoint = query
          ? `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&limit=50`
          : `https://g.tenor.com/v1/trending?key=${TENOR_API_KEY}&limit=50`;
        
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error('Failed to fetch GIFs');
        const data = await res.json();
        setGifs(data.results || []);
      } catch (err) {
        console.error('Error fetching GIFs:', err);
        setError('Failed to load GIFs.');
      } finally {
        setLoading(false);
      }
    };

    const delayDebounce = setTimeout(() => {
      fetchGifs();
    }, 400); // 400ms debounce

    return () => clearTimeout(delayDebounce);
  }, [activeCategory, searchQuery]);

  return (
    <div className="gif-picker-wrapper" ref={pickerRef}>
      <div className="gif-picker-header">
        <Search size={16} className="gif-search-icon" />
        <input
          type="text"
          className="gif-search-input"
          placeholder="Search Tenor"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="gif-category-row">
        {GIF_CATEGORIES.map((category) => (
          <button
            type="button"
            key={category}
            className={`gif-category-chip ${activeCategory === category ? 'active' : ''}`}
            onClick={() => {
              setActiveCategory(category);
              setSearchQuery('');
            }}
          >
            {category}
          </button>
        ))}
      </div>

      <div className="gif-picker-content custom-scrollbar">
        {loading && gifs.length === 0 ? (
          <div className="gif-loading">
            <Loader2 size={24} className="spin" />
          </div>
        ) : error ? (
          <div className="gif-error">{error}</div>
        ) : gifs.length === 0 ? (
          <div className="gif-empty">No GIFs found.</div>
        ) : (
          <div className="gif-grid">
            {gifs.map((gif) => (
              <div
                key={gif.id}
                className="gif-item"
                onClick={() => {
                  const media = gif.media[0];
                  // Send actual gif url
                  onSelect(media.gif.url);
                }}
              >
                <img src={gif.media[0].tinygif.url} alt="GIF" loading="lazy" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
