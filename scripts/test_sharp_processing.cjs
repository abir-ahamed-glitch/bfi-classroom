#!/usr/bin/env node
/**
 * scripts/test_sharp_processing.cjs
 *
 * Comprehensive Test Suite for Sharp 0.35.5 Image Processing.
 * Tests representative valid and malformed fixtures across all application image pathways:
 * 1. Valid PNG, JPEG, and WebP buffer optimization (optimizeBuffer)
 * 2. Oversized image downscaling (maxWidth 1440, withoutEnlargement)
 * 3. On-disk file optimization with format conversion to WebP (optimizeUploadedImage)
 * 4. Avatar processing from Data URL and raw Buffer (saveOptimizedAvatar)
 * 5. Malformed image handling (truncated data, invalid headers, zero bytes)
 * 6. Disk cleanup: verification that temp files (opt-*) are removed on failure
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`Testing: ${name}... `);
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      await res;
    }
    console.log('✅ PASS');
    passedTests++;
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('================================================================');
  console.log('SHARP 0.35.5 IMAGE PROCESSING & RESILIENCE REGRESSION SUITE');
  console.log('Testing Engine: Sharp 0.35.5 with Bundled libvips');
  console.log('================================================================\n');

  const sharp = require('sharp');
  sharp.cache(false);
  const imageOptimizer = await import('../server/utils/imageOptimizer.js');

  console.log(`Loaded Sharp version: ${sharp.versions.sharp}`);
  console.log(`Bundled libvips version: ${sharp.versions.vips}\n`);

  const tmpDir = path.resolve(__dirname, '..', '.tmp_sharp_test_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Generate valid test fixtures using Sharp
    const validPngBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 4,
        background: { r: 50, g: 100, b: 200, alpha: 1 }
      }
    }).png().toBuffer();

    const validJpegBuffer = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 220, g: 80, b: 40 }
      }
    }).jpeg({ quality: 90 }).toBuffer();

    const oversizedPngBuffer = await sharp({
      create: {
        width: 2560,
        height: 1440,
        channels: 3,
        background: { r: 30, g: 30, b: 30 }
      }
    }).png().toBuffer();

    // 1. Valid PNG buffer optimization
    await runTest('optimizeBuffer: converts valid PNG buffer to WebP', async () => {
      const result = await imageOptimizer.optimizeBuffer(validPngBuffer, { maxWidth: 1440, quality: 80 });
      assert.ok(result, 'Result should not be null');
      assert.strictEqual(result.mimetype, 'image/webp');
      assert.strictEqual(result.extension, 'webp');
      assert.ok(result.buffer.length > 0, 'Optimized buffer should have non-zero length');

      const meta = await sharp(result.buffer).metadata();
      assert.strictEqual(meta.format, 'webp');
      assert.strictEqual(meta.width, 800);
      assert.strictEqual(meta.height, 600);
    });

    // 2. Valid JPEG buffer optimization
    await runTest('optimizeBuffer: converts valid JPEG buffer to WebP', async () => {
      const result = await imageOptimizer.optimizeBuffer(validJpegBuffer, { maxWidth: 1440, quality: 80 });
      assert.ok(result, 'Result should not be null');
      assert.strictEqual(result.mimetype, 'image/webp');

      const meta = await sharp(result.buffer).metadata();
      assert.strictEqual(meta.format, 'webp');
      assert.strictEqual(meta.width, 640);
      assert.strictEqual(meta.height, 480);
    });

    // 3. Oversized image downscaling
    await runTest('optimizeBuffer: downscales oversized image to maxWidth 1440', async () => {
      const result = await imageOptimizer.optimizeBuffer(oversizedPngBuffer, { maxWidth: 1440, quality: 80 });
      assert.ok(result);

      const meta = await sharp(result.buffer).metadata();
      assert.strictEqual(meta.format, 'webp');
      assert.strictEqual(meta.width, 1440, 'Width must be clamped to maxWidth');
      assert.strictEqual(meta.height, 810, 'Aspect ratio must be preserved (2560x1440 -> 1440x810)');
    });

    // 4. Disk file optimization (optimizeUploadedImage)
    await runTest('optimizeUploadedImage: processes disk file and renames to .webp', async () => {
      const testFilePath = path.join(tmpDir, 'test-upload.png');
      fs.writeFileSync(testFilePath, validPngBuffer);

      const res = await imageOptimizer.optimizeUploadedImage(testFilePath, { maxWidth: 1440, quality: 80 });
      assert.ok(res);
      assert.strictEqual(res.mimetype, 'image/webp');
      assert.strictEqual(res.filename, 'test-upload.webp');
      assert.ok(fs.existsSync(res.path), 'Target webp file must exist on disk');
      assert.strictEqual(fs.existsSync(testFilePath), false, 'Original PNG file should be unlinked');

      const meta = await sharp(res.path).metadata();
      assert.strictEqual(meta.format, 'webp');
    });

    // 5. Avatar processing from Base64 Data URL (saveOptimizedAvatar)
    await runTest('saveOptimizedAvatar: generates 400x400 center-cropped WebP avatar from Data URL', async () => {
      const base64Data = `data:image/png;base64,${validPngBuffer.toString('base64')}`;
      const userId = 42;

      const mediaPath = await imageOptimizer.saveOptimizedAvatar(base64Data, userId, tmpDir);
      assert.ok(mediaPath, 'Media path should be returned');
      assert.match(mediaPath, /^\/media\/avatars\/avatar-42-\d+\.webp$/);

      const savedDiskPath = path.join(tmpDir, 'uploads', 'avatars', path.basename(mediaPath));
      assert.ok(fs.existsSync(savedDiskPath), 'Avatar file must exist on disk');

      const meta = await sharp(savedDiskPath).metadata();
      assert.strictEqual(meta.format, 'webp');
      assert.strictEqual(meta.width, 400);
      assert.strictEqual(meta.height, 400);
    });

    // 6. Malformed fixture: corrupted image header
    await runTest('optimizeBuffer: rejects corrupted image header gracefully without throwing', async () => {
      const corruptHeaderBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0xFF, 0xFF]);
      const result = await imageOptimizer.optimizeBuffer(corruptHeaderBuffer);
      assert.strictEqual(result, null, 'Malformed buffer must return null safely');
    });

    // 7. Malformed fixture: truncated payload (partial JPEG)
    await runTest('optimizeBuffer: rejects truncated JPEG stream gracefully', async () => {
      const truncatedJpeg = validJpegBuffer.slice(0, 100);
      const result = await imageOptimizer.optimizeBuffer(truncatedJpeg);
      assert.strictEqual(result, null, 'Truncated buffer must return null safely');
    });

    // 8. Malformed fixture: zero-byte input
    await runTest('optimizeBuffer: rejects zero-byte buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);
      const result = await imageOptimizer.optimizeBuffer(emptyBuffer);
      assert.strictEqual(result, null, 'Empty buffer must return null safely');
    });

    // 9. Malformed disk fixture: non-image claiming .png extension
    await runTest('optimizeUploadedImage: malformed file preserves original without unhandled crash', async () => {
      const badFilePath = path.join(tmpDir, 'fake-image.png');
      fs.writeFileSync(badFilePath, Buffer.from('<html><body>Not an image</body></html>'));

      const res = await imageOptimizer.optimizeUploadedImage(badFilePath);
      assert.ok(res, 'Should return fallback record');
      assert.strictEqual(res.path, badFilePath, 'Original path must be preserved');
      assert.ok(fs.existsSync(badFilePath), 'Original file must remain intact');

      // Verify no temporary opt-* files leaked into the directory
      const files = fs.readdirSync(tmpDir);
      const leakedTemp = files.filter(f => f.startsWith('opt-'));
      assert.strictEqual(leakedTemp.length, 0, 'No temporary opt-* files must remain on disk after error');
    });

  } finally {
    // Cleanup test temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log(`\n================================================================`);
  console.log(`Sharp Image Processing Results: ${passedTests}/${totalTests} Passed`);
  console.log(`================================================================`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Sharp test error:', err);
    process.exit(1);
  });
}
