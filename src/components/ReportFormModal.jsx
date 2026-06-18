import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flag, LoaderCircle, Paperclip, Upload, X } from 'lucide-react';
import './ReportFormModal.css';

export default function ReportFormModal({
  open,
  title,
  subtitle,
  categories,
  onClose,
  onSubmit,
  detailLabel = 'Details',
  detailPlaceholder = 'Explain in your own words what happened and why you are reporting this (optional, max 500 characters)',
}) {
  const [reasonCategory, setReasonCategory] = useState('');
  const [reasonDetail, setReasonDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [screenshotPath, setScreenshotPath] = useState('');
  const [screenshotPreview, setScreenshotPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, submitting]);

  useEffect(() => {
    if (open) {
      setReasonCategory('');
      setReasonDetail('');
      setSubmitting(false);
      setError('');
      setScreenshotPath('');
      setScreenshotPreview('');
      setUploading(false);
      setUploadError('');
      setDragActive(false);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (!reasonCategory || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        reason_category: reasonCategory,
        reason_detail: reasonDetail.trim(),
        screenshot_path: screenshotPath || null,
      });
      onClose();
    } catch (submitError) {
      setError(submitError.message || 'Unable to submit this report.');
    } finally {
      setSubmitting(false);
    }
  };

  const uploadScreenshot = async (file) => {
    if (!file || uploading) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setUploadError('Upload failed. Please try again.');
      return;
    }
    setUploading(true);
    setUploadError('');
    const formData = new FormData();
    formData.append('screenshot', file);
    try {
      const response = await fetch('/api/reports/upload-screenshot', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Upload failed.');
      setScreenshotPath(data.path);
      setScreenshotPreview(URL.createObjectURL(file));
    } catch {
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return createPortal(
    <div className="report-form-layer" role="presentation">
      <button
        type="button"
        className="report-form-backdrop"
        onClick={() => !submitting && onClose()}
        aria-label="Close report form"
      />
      <form className="report-form-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="report-form-title">
        <header className="report-form-header">
          <div className="report-form-heading">
            <span className="report-form-icon"><Flag size={20} /></span>
            <div>
              <h2 id="report-form-title">{title}</h2>
              <p>{subtitle}</p>
            </div>
          </div>
          <button type="button" className="report-form-close" onClick={onClose} disabled={submitting} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="report-form-body">
          <label className="report-form-field">
            <span>Reason</span>
            <select value={reasonCategory} onChange={(event) => setReasonCategory(event.target.value)} required>
              <option value="">Select a reason</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>

          <label className="report-form-field">
            <span>{detailLabel} <small>Optional</small></span>
            <textarea
              value={reasonDetail}
              onChange={(event) => setReasonDetail(event.target.value.slice(0, 500))}
              placeholder={detailPlaceholder}
              rows={5}
            />
            <span className="report-form-counter">{reasonDetail.length}/500</span>
          </label>

          <div className="report-screenshot-field">
            <span className="report-screenshot-label"><Paperclip size={15} /> Attach a Screenshot <small>Optional</small></span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => uploadScreenshot(event.target.files?.[0])}
            />
            <button
              type="button"
              className={`report-screenshot-dropzone${dragActive ? ' drag-active' : ''}${screenshotPreview ? ' has-preview' : ''}`}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                uploadScreenshot(event.dataTransfer.files?.[0]);
              }}
            >
              {uploading ? (
                <><LoaderCircle className="report-upload-spinner" size={22} /><span>Uploading screenshot...</span></>
              ) : screenshotPreview ? (
                <span className="report-screenshot-preview">
                  <img src={screenshotPreview} alt="Screenshot preview" />
                  <span
                    role="button"
                    tabIndex={0}
                    className="report-screenshot-remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      setScreenshotPath('');
                      setScreenshotPreview('');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.click()}
                    aria-label="Remove screenshot"
                  ><X size={14} /></span>
                </span>
              ) : (
                <><Upload size={21} /><strong>Click to upload or drag & drop</strong><span>PNG, JPG, WEBP · Max 5MB</span></>
              )}
            </button>
            {uploadError && <span className="report-screenshot-error">{uploadError}</span>}
          </div>

          {error && <p className="report-form-error">{error}</p>}
        </div>

        <footer className="report-form-actions">
          <button type="button" className="report-form-cancel" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="report-form-submit" disabled={!reasonCategory || submitting || uploading}>
            {submitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
