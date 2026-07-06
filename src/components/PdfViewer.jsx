import React, { useEffect, useState } from 'react';
import { Worker, Viewer } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';

// Import styles
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

export default function PdfViewer({ url, name, containerStyle = {} }) {
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const defaultLayoutPluginInstance = defaultLayoutPlugin();

  useEffect(() => {
    if (!url) return;

    // Check if the URL is our custom base64 API endpoint
    if (url.includes('/base64')) {
      let isMounted = true;
      setLoading(true);
      setError(null);
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
          setResolvedUrl(objectUrl);
          setLoading(false);
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
      setResolvedUrl(url);
      setLoading(false);
      setError(null);
    }
  }, [url]);

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
        <Worker workerUrl={`https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js`}>
          <Viewer
            fileUrl={resolvedUrl}
            plugins={[defaultLayoutPluginInstance]}
          />
        </Worker>
      )}
    </div>
  );
}
