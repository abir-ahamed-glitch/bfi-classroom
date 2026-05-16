/**
 * Resolves a media URL from the backend or external source.
 * Handles:
 * - External URLs (http/https) via backend proxy to bypass CSP
 * - Data URLs (data:)
 * - Blob URLs (blob:)
 * - Absolute paths (starting with '/') - returned as-is
 * - Local paths (converts 'uploads/' to '/media/')
 * 
 * @param {string} url - The URL or path to resolve
 * @returns {string|null} - The resolved absolute or relative URL
 */
export const resolveMediaUrl = (url) => {
  if (!url) return null;
  
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

  // If it's an external URL (http/https), use the proxy to bypass strict CSPs (like in Incognito)
  if (/^https?:\/\//i.test(url)) {
    // Only proxy if it's truly external (not our own domain)
    if (!url.includes(window.location.hostname)) {
      return `${base}api/proxy-image?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }

  // Absolute paths (start with '/') are already root-relative — return as-is
  // e.g. '/bfi-classroom/avatars/male2.png' should NOT be re-prefixed
  if (url.startsWith('/')) {
    const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
    if (url.startsWith(baseUrl + '/') || url === baseUrl) {
      return url;
    }
    return `${baseUrl}${url}`;
  }

  // Handle relative local paths
  let cleanPath = url.replace(/^\.?\//, '');
  
  // Special case for public assets like avatars (relative path, no leading slash)
  if (cleanPath.startsWith('avatars/')) {
    return `${base}${cleanPath}`;
  }

  if (cleanPath.startsWith('uploads/')) {
    cleanPath = cleanPath.replace('uploads/', 'media/');
  }
  
  if (cleanPath.startsWith('media/')) {
    return `${base}${cleanPath}`;
  }

  return `${base}media/${cleanPath}`;
};

/**
 * Compresses an image file by resizing and adjusting quality.
 * Keeps resolution up to maxDimension and reduces file size similar to social media platforms.
 * 
 * @param {File} file - The original image file
 * @param {number} maxDimension - The maximum width or height (e.g. 1920)
 * @param {number} quality - JPEG compression quality (0.0 to 1.0)
 * @returns {Promise<File>} - A Promise that resolves to the compressed File
 */
export const compressImage = (file, maxDimension = 1920, quality = 0.8) => {
  return new Promise((resolve) => {
    if (!file || !file.type.startsWith('image/')) {
      resolve(file); // Return original if not an image
      return;
    }
    
    // Don't compress GIFs to avoid losing animation
    if (file.type === 'image/gif') {
      resolve(file);
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(file); // fallback
            return;
          }
          // Provide a new File object with the exact same name, replacing extension with .jpg
          const newFileName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
          const compressedFile = new File([blob], newFileName, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        }, 'image/jpeg', quality);
      };
      img.onerror = (error) => {
        console.error('Image compression error', error);
        resolve(file); // Fallback to original
      };
    };
    reader.onerror = (error) => {
      console.error('FileReader error', error);
      resolve(file); // Fallback to original
    };
  });
};
