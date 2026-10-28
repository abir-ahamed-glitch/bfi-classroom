import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_ISOLATED_DIR = path.resolve(__dirname, '..', '.tmp_test_runs');
if (!fs.existsSync(TEST_ISOLATED_DIR)) {
  fs.mkdirSync(TEST_ISOLATED_DIR, { recursive: true });
}

export const TEST_SHARED_GOV_DB = path.resolve(TEST_ISOLATED_DIR, 'test_shared_governance.db');
process.env.DATABASE_PATH = TEST_SHARED_GOV_DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-unit-testing-32-chars';
process.env.IS_TEST_SERVER = 'true';
