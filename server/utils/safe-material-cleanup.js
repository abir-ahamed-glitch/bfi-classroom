import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Canonical managed directory for uploaded course materials
const COURSE_MATERIALS_DIR = path.resolve(__dirname, '../../uploads/course-materials');

/**
 * Safely unlinks a managed course material file upon replacement or cleanup.
 * 
 * Strict Security Boundaries:
 * 1. Scope restriction: Only files under uploads/course-materials/ are managed.
 *    External URLs, inbox attachments, report screenshots, etc. are rejected.
 * 2. Traversal rejection: Filenames with '..', '/', or '\' are rejected immediately.
 * 3. Sibling prefix defense: Target path must start with `canonicalBase + path.sep`.
 *    Plain `startsWith(canonicalBase)` without separator is strictly prevented.
 * 4. Symlink protection: `fs.lstatSync` ensures the target is not a symlink.
 * 5. Canonical target verification: `fs.realpathSync` confirms real path remains inside base.
 * 6. Regular file verification: Directories and non-files cannot be unlinked.
 * 
 * @param {string} fileUrl The file_url from course_materials row.
 * @param {string} [customBaseDir] Optional override for isolated unit testing.
 * @returns {{ success: boolean, reason?: string, unlinkedPath?: string, error?: string }}
 */
export function safeDeleteCourseMaterialFile(fileUrl, customBaseDir = null) {
  if (!fileUrl || typeof fileUrl !== 'string') {
    return { success: false, reason: 'INVALID_URL' };
  }

  // Must match managed course materials URL pattern
  const match = fileUrl.trim().match(/^(?:\/bfi-classroom)?\/media\/course-materials\/([^?#]+)$/);
  if (!match) {
    // Non-course-material files (external links, inbox attachments, etc.) are untouched
    return { success: false, reason: 'NOT_MANAGED_FILE' };
  }

  const rawFilename = match[1];

  // Path traversal check
  if (rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
    return { success: false, reason: 'PATH_TRAVERSAL_DETECTED' };
  }

  const baseDir = customBaseDir || COURSE_MATERIALS_DIR;
  if (!fs.existsSync(baseDir)) {
    return { success: false, reason: 'BASE_DIR_NOT_FOUND' };
  }

  let canonicalBase;
  try {
    canonicalBase = fs.realpathSync(baseDir);
  } catch (err) {
    return { success: false, reason: 'BASE_CANONICALIZATION_FAILED', error: err.message };
  }

  // Enforce boundary separator to prevent sibling prefix tricks
  const expectedPrefix = canonicalBase.endsWith(path.sep) ? canonicalBase : canonicalBase + path.sep;

  const targetPath = path.resolve(canonicalBase, rawFilename);
  if (!targetPath.startsWith(expectedPrefix)) {
    return { success: false, reason: 'ESCAPED_BASE_DIRECTORY' };
  }

  if (!fs.existsSync(targetPath)) {
    return { success: false, reason: 'FILE_NOT_FOUND' };
  }

  // Prevent symlink attacks
  let lstat;
  try {
    lstat = fs.lstatSync(targetPath);
  } catch (err) {
    return { success: false, reason: 'STAT_ERROR', error: err.message };
  }

  if (lstat.isSymbolicLink()) {
    return { success: false, reason: 'SYMLINK_REJECTED' };
  }

  let realTarget;
  try {
    realTarget = fs.realpathSync(targetPath);
  } catch (err) {
    return { success: false, reason: 'REALPATH_ERROR', error: err.message };
  }

  if (!realTarget.startsWith(expectedPrefix)) {
    return { success: false, reason: 'REALPATH_ESCAPED_BASE' };
  }

  if (!fs.statSync(realTarget).isFile()) {
    return { success: false, reason: 'NOT_A_REGULAR_FILE' };
  }

  try {
    fs.unlinkSync(realTarget);
    return { success: true, unlinkedPath: realTarget };
  } catch (err) {
    return { success: false, reason: 'UNLINK_FAILED', error: err.message };
  }
}
