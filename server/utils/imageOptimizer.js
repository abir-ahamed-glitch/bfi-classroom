import fs from 'fs';
import path from 'path';

let sharpModule = null;

// Dynamically load sharp if available
async function getSharp() {
  if (sharpModule !== null) return sharpModule;
  try {
    const mod = await import('sharp');
    sharpModule = mod.default || mod;
  } catch (err) {
    sharpModule = false;
    console.warn('[ImageOptimizer] sharp library is not loaded. Image passthrough mode active:', err.message);
  }
  return sharpModule;
}

const SUPPORTED_OPTIMIZE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff']);

/**
 * Optimizes an uploaded image file on disk.
 * Resizes down if larger than maxWidth, strips EXIF, and re-encodes as WebP.
 * 
 * @param {string} filePath - Absolute path to uploaded file
 * @param {Object} [options]
 * @param {number} [options.maxWidth=1440]
 * @param {number} [options.quality=82]
 * @returns {Promise<{path: string, filename: string, mimetype: string, size: number}>}
 */
export async function optimizeUploadedImage(filePath, options = {}) {
  const { maxWidth = 1440, quality = 82 } = options;

  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const ext = path.extname(filePath).toLowerCase();
  const originalSize = fs.statSync(filePath).size;

  // Don't alter non-raster or non-image files
  if (!SUPPORTED_OPTIMIZE_EXTENSIONS.has(ext)) {
    return {
      path: filePath,
      filename: path.basename(filePath),
      mimetype: ext === '.pdf' ? 'application/pdf' : 'application/octet-stream',
      size: originalSize
    };
  }

  const sharp = await getSharp();
  if (!sharp) {
    return {
      path: filePath,
      filename: path.basename(filePath),
      mimetype: ext === '.png' ? 'image/png' : 'image/jpeg',
      size: originalSize
    };
  }

  try {
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, ext);
    const newFilename = `${baseName}.webp`;
    const tempOutputPath = path.join(dir, `opt-${Date.now()}-${newFilename}`);

    await sharp(filePath)
      .rotate() // Auto-orient based on EXIF tag
      .resize({
        width: maxWidth,
        withoutEnlargement: true,
        fit: 'inside'
      })
      .webp({ quality, effort: 4 })
      .toFile(tempOutputPath);

    const newSize = fs.statSync(tempOutputPath).size;

    // If for some reason the output is larger (rare with WebP), and original was already WebP, keep original
    if (newSize >= originalSize && ext === '.webp') {
      try { fs.unlinkSync(tempOutputPath); } catch (_) {}
      return {
        path: filePath,
        filename: path.basename(filePath),
        mimetype: 'image/webp',
        size: originalSize
      };
    }

    // Safely remove original and rename temp to target webp filename
    const finalOutputPath = path.join(dir, newFilename);
    try { fs.unlinkSync(filePath); } catch (_) {}
    if (fs.existsSync(finalOutputPath)) {
      try { fs.unlinkSync(finalOutputPath); } catch (_) {}
    }
    fs.renameSync(tempOutputPath, finalOutputPath);

    return {
      path: finalOutputPath,
      filename: newFilename,
      mimetype: 'image/webp',
      size: newSize
    };
  } catch (err) {
    console.warn('[ImageOptimizer] Failed to optimize image file, preserving original:', err.message);
    return {
      path: filePath,
      filename: path.basename(filePath),
      mimetype: ext === '.png' ? 'image/png' : 'image/jpeg',
      size: originalSize
    };
  }
}

/**
 * Optimizes an in-memory image buffer (e.g. from multer.memoryStorage).
 * 
 * @param {Buffer} buffer 
 * @param {Object} [options]
 * @param {number} [options.maxWidth=1440]
 * @param {number} [options.quality=80]
 * @returns {Promise<{buffer: Buffer, mimetype: string, extension: string, size: number}|null>}
 */
export async function optimizeBuffer(buffer, options = {}) {
  const { maxWidth = 1440, quality = 80 } = options;

  if (!buffer || !Buffer.isBuffer(buffer)) return null;

  const sharp = await getSharp();
  if (!sharp) return null;

  try {
    const optimizedBuffer = await sharp(buffer)
      .rotate()
      .resize({
        width: maxWidth,
        withoutEnlargement: true,
        fit: 'inside'
      })
      .webp({ quality, effort: 4 })
      .toBuffer();

    return {
      buffer: optimizedBuffer,
      mimetype: 'image/webp',
      extension: 'webp',
      size: optimizedBuffer.length
    };
  } catch (err) {
    console.warn('[ImageOptimizer] Buffer optimization failed:', err.message);
    return null;
  }
}

/**
 * Converts a base64 Data URL or Buffer to an optimized WebP avatar file on disk.
 * Returns the public media path `/media/avatars/avatar-<userId>-<timestamp>.webp`.
 * 
 * @param {string|Buffer} source - Base64 Data URL or raw Buffer
 * @param {number|string} userId - User ID
 * @param {string} rootDir - Root directory containing 'uploads'
 * @returns {Promise<string|null>} - Relative media path or null
 */
export async function saveOptimizedAvatar(source, userId, rootDir) {
  if (!source || !userId) return null;

  const avatarDir = path.join(rootDir, 'uploads', 'avatars');
  if (!fs.existsSync(avatarDir)) {
    fs.mkdirSync(avatarDir, { recursive: true });
  }

  let inputBuffer = null;
  if (Buffer.isBuffer(source)) {
    inputBuffer = source;
  } else if (typeof source === 'string') {
    if (source.startsWith('data:image/')) {
      const match = source.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
      if (match && match[1]) {
        inputBuffer = Buffer.from(match[1], 'base64');
      }
    }
  }

  if (!inputBuffer) return null;

  const filename = `avatar-${userId}-${Date.now()}.webp`;
  const targetPath = path.join(avatarDir, filename);

  const sharp = await getSharp();
  if (sharp) {
    try {
      await sharp(inputBuffer)
        .rotate()
        .resize(400, 400, { fit: 'cover', position: 'center' })
        .webp({ quality: 82, effort: 4 })
        .toFile(targetPath);

      // Clean up previous avatars for this user
      cleanupOldAvatars(avatarDir, userId, filename);

      return `/media/avatars/${filename}`;
    } catch (err) {
      console.warn('[ImageOptimizer] Avatar sharp optimization failed, saving raw buffer:', err.message);
    }
  }

  // Fallback: write buffer directly if sharp not loaded
  try {
    fs.writeFileSync(targetPath, inputBuffer);
    cleanupOldAvatars(avatarDir, userId, filename);
    return `/media/avatars/${filename}`;
  } catch (err) {
    console.error('[ImageOptimizer] Failed to save avatar:', err);
    return null;
  }
}

function cleanupOldAvatars(avatarDir, userId, keepFilename) {
  try {
    const files = fs.readdirSync(avatarDir);
    const prefix = `avatar-${userId}-`;
    for (const file of files) {
      if (file.startsWith(prefix) && file !== keepFilename) {
        try { fs.unlinkSync(path.join(avatarDir, file)); } catch (_) {}
      }
    }
  } catch (_) {}
}
