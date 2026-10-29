import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure process.env is securely primed with .env before any other module executes
if (process.env.IS_STAGING_SERVER !== 'true') {
  let envPath = process.env.DOTENV_CONFIG_PATH;
  if (!envPath) {
    const cwdEnv = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(cwdEnv)) {
      envPath = cwdEnv;
    } else {
      envPath = path.resolve(__dirname, '..', '.env');
    }
  }
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  } else {
    dotenv.config({ override: true });
  }
}
