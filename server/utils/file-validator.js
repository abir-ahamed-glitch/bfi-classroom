import path from 'path';

/**
 * Strict extension-to-MIME mapping for certificate templates.
 */
export const CERTIFICATE_ALLOWED_TYPES = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp']
};

/**
 * Strict extension-to-MIME mapping for general course materials.
 */
export const COURSE_ATTACHMENT_ALLOWED_TYPES = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
  '.zip': ['application/zip', 'application/x-zip-compressed']
};

/**
 * Dangerous extensions that must never be accepted under any circumstances.
 */
const FORBIDDEN_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml', '.svg', '.svgz', '.xml',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.php', '.php3', '.php4', '.php5', '.phtml',
  '.jsp', '.asp', '.aspx', '.cgi', '.pl', '.py',
  '.sh', '.bash', '.exe', '.bat', '.cmd', '.ps1',
  '.htaccess', '.htpasswd', '.config'
]);

/**
 * Validates that the filename extension and declared MIME type match an allowed mapping.
 */
export function validateExtensionAndMime(originalname, mimetype, allowedMap) {
  if (!originalname || !mimetype) {
    return { valid: false, error: 'Filename and MIME type are required' };
  }

  const ext = path.extname(originalname).toLowerCase();
  if (!ext || FORBIDDEN_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Disallowed or dangerous file extension: ${ext}` };
  }

  const allowedMimes = allowedMap[ext];
  if (!allowedMimes) {
    return { valid: false, error: `File extension ${ext} is not allowed` };
  }

  const cleanMime = String(mimetype).trim().toLowerCase();
  if (!allowedMimes.includes(cleanMime)) {
    return { valid: false, error: `MIME type ${cleanMime} does not match allowed types for extension ${ext}` };
  }

  return { valid: true };
}

/**
 * Validates file magic bytes against the expected format.
 */
export function validateMagicBytes(buffer, ext) {
  if (!buffer || buffer.length < 4) {
    return { valid: false, error: 'Buffer is too small to determine file signature' };
  }

  const normalizedExt = ext.toLowerCase();

  switch (normalizedExt) {
    case '.png':
      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4E &&
        buffer[3] === 0x47
      ) {
        return { valid: true };
      }
      return { valid: false, error: 'Invalid PNG signature' };

    case '.jpg':
    case '.jpeg':
      // JPEG magic bytes: FF D8 FF
      if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { valid: true };
      }
      return { valid: false, error: 'Invalid JPEG signature' };

    case '.webp':
      // WebP magic bytes: 'RIFF' .... 'WEBP'
      if (buffer.length >= 12) {
        const riff = buffer.toString('ascii', 0, 4);
        const webp = buffer.toString('ascii', 8, 12);
        if (riff === 'RIFF' && webp === 'WEBP') {
          return { valid: true };
        }
      }
      return { valid: false, error: 'Invalid WebP signature' };

    case '.pdf':
      // PDF magic bytes: '%PDF' (25 50 44 46)
      if (buffer.toString('ascii', 0, 4) === '%PDF') {
        return { valid: true };
      }
      return { valid: false, error: 'Invalid PDF signature' };

    case '.zip':
    case '.docx':
      // ZIP / DOCX (PKZip): 'PK\x03\x04'
      if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
        return { valid: true };
      }
      return { valid: false, error: 'Invalid ZIP/DOCX container signature' };

    case '.doc':
      // OLE Compound Document: D0 CF 11 E0
      if (
        buffer[0] === 0xD0 &&
        buffer[1] === 0xCF &&
        buffer[2] === 0x11 &&
        buffer[3] === 0xE0
      ) {
        return { valid: true };
      }
      return { valid: false, error: 'Invalid DOC signature' };

    default:
      return { valid: false, error: `Unsupported extension for signature verification: ${normalizedExt}` };
  }
}
