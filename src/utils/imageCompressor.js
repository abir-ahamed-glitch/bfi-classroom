/**
 * High-performance client-side image optimization pipeline for BFI Classroom.
 * 
 * Automatically downsizes huge camera/mobile phone photos (e.g. 12-48MP, 5-15MB)
 * to web-optimized dimensions (default max 1440px) and converts to modern WebP (or JPEG fallback)
 * at 82% quality before the file ever leaves the student's browser.
 * 
 * Benefits:
 * - 90% - 98% reduction in network payload (8MB down to ~80-120KB)
 * - Eliminates mobile upload timeouts and saves mobile data
 * - Protects server RAM, CPU, and disk storage under high concurrency
 * - Strips EXIF metadata automatically via HTML5 canvas
 */

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.3gp', '.mpeg', '.mpg', '.ogv'
]);

/**
 * Check if a file or object is a video file.
 * @param {File|Blob|string} file 
 * @returns {boolean}
 */
export function isVideoFile(file) {
  if (!file) return false;
  if (typeof file === 'string') {
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    return VIDEO_EXTENSIONS.has(ext);
  }
  if (file.type && file.type.startsWith('video/')) return true;
  if (file.name) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    return VIDEO_EXTENSIONS.has(ext);
  }
  return false;
}

/**
 * Check if a file or object is an image file.
 * @param {File|Blob|string} file 
 * @returns {boolean}
 */
export function isImageFile(file) {
  if (!file) return false;
  if (typeof file === 'string') {
    if (file.startsWith('data:image/')) return true;
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'].includes(ext);
  }
  if (file.type && file.type.startsWith('image/')) return true;
  if (file.name) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'].includes(ext);
  }
  return false;
}

/**
 * Checks if the browser supports WebP canvas encoding.
 */
let _webpSupported = null;
export function isWebPSupported() {
  if (_webpSupported !== null) return _webpSupported;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    _webpSupported = canvas.toDataURL('image/webp').indexOf('image/webp') === 5;
  } catch {
    _webpSupported = false;
  }
  return _webpSupported;
}

/**
 * Load an image from a File, Blob, or URL string into an HTMLImageElement.
 */
function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    let objectUrl = null;
    if (source instanceof Blob || source instanceof File) {
      objectUrl = URL.createObjectURL(source);
      img.src = objectUrl;
    } else if (typeof source === 'string') {
      img.src = source;
    } else {
      return reject(new Error('Invalid image source'));
    }

    img.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = (err) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(err);
    };
  });
}

/**
 * Format bytes into human-readable string.
 */
export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Compresses an image File or Blob.
 * 
 * @param {File|Blob} file - Original image file
 * @param {Object} options
 * @param {number} [options.maxWidth=1440] - Maximum width in pixels
 * @param {number} [options.maxHeight=1440] - Maximum height in pixels
 * @param {number} [options.quality=0.82] - Compression quality (0 to 1)
 * @param {'file'|'blob'|'dataUrl'} [options.outputFormat='file'] - Return format
 * @returns {Promise<File|Blob|string>}
 */
export async function compressImage(file, options = {}) {
  const {
    maxWidth = 1440,
    maxHeight = 1440,
    quality = 0.82,
    outputFormat = (file instanceof File ? 'file' : 'blob')
  } = options;

  if (!file) return file;

  // Preserve animated GIFs and SVGs without rasterizing
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    if (outputFormat === 'dataUrl') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    return file;
  }

  // Not an image file: return as-is
  if (file.type && !file.type.startsWith('image/')) {
    return file;
  }

  try {
    const img = await loadImage(file);
    let { width, height } = img;

    // Calculate aspect-ratio-preserving dimensions
    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    // High quality bicubic filtering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(img, 0, 0, width, height);

    // Determine target format: WebP preferred, JPEG fallback
    const targetMime = isWebPSupported() ? 'image/webp' : 'image/jpeg';
    const targetExt = targetMime === 'image/webp' ? '.webp' : '.jpg';

    if (outputFormat === 'dataUrl') {
      const dataUrl = canvas.toDataURL(targetMime, quality);
      return dataUrl;
    }

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, targetMime, quality);
    });

    if (!blob) return file;

    // If compression somehow produced a larger file than original, keep original
    if (file.size && blob.size > file.size && file.type === targetMime) {
      return file;
    }

    if (outputFormat === 'blob') {
      return blob;
    }

    // Convert back to File object preserving/updating name
    const originalName = file.name || 'image';
    const baseName = originalName.replace(/\.[^/.]+$/, '');
    const newFileName = `${baseName}${targetExt}`;

    return new File([blob], newFileName, {
      type: targetMime,
      lastModified: Date.now()
    });
  } catch (err) {
    console.warn('[ImageCompressor] Client-side compression failed, falling back to original file:', err);
    return file;
  }
}

/**
 * Compresses a Data URL string directly (useful for clipboard pastes or webcam/cropper outputs).
 * 
 * @param {string} dataUrl - Raw Data URL string
 * @param {Object} options
 * @param {number} [options.maxWidth=1440]
 * @param {number} [options.maxHeight=1440]
 * @param {number} [options.quality=0.82]
 * @returns {Promise<string>}
 */
export async function compressDataUrl(dataUrl, options = {}) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }

  // Preserve animated GIFs and SVGs
  if (dataUrl.startsWith('data:image/gif') || dataUrl.startsWith('data:image/svg+xml')) {
    return dataUrl;
  }

  const {
    maxWidth = 1440,
    maxHeight = 1440,
    quality = 0.82
  } = options;

  try {
    const img = await loadImage(dataUrl);
    let { width, height } = img;

    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    const targetMime = isWebPSupported() ? 'image/webp' : 'image/jpeg';
    const compressed = canvas.toDataURL(targetMime, quality);

    // Keep original if smaller
    if (compressed.length >= dataUrl.length && dataUrl.startsWith(`data:${targetMime}`)) {
      return dataUrl;
    }

    return compressed;
  } catch (err) {
    console.warn('[ImageCompressor] Failed to compress data URL, returning original:', err);
    return dataUrl;
  }
}
