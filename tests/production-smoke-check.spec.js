import { test, expect } from '@playwright/test';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Production Smoke Check CLI & Deployment Gate Specification', () => {
  const runnerScript = path.resolve(__dirname, '..', 'scripts', 'test_production_smoke_check.cjs');

  test('Production smoke check CLI verifies all 32 requirement vectors', async () => {
    const res = spawnSync(process.execPath, [runnerScript], {
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 30000
    });

    if (res.status !== 0) {
      console.error(res.stdout);
      console.error(res.stderr);
    }

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('CLI TEST SUITE COMPLETE: 32 PASSED, 0 FAILED');
  });
});
