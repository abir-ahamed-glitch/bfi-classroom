import stagingGuard from '../scripts/staging_guard.cjs';

try {
  const config = stagingGuard.loadAndValidateStagingEnv();
  process.env.DATABASE_PATH = config.databasePath;
  process.env.PORT = String(config.port);
  process.env.NODE_ENV = 'production';
  process.env.APP_URL = config.appUrl;
  process.env.CLIENT_URL = config.clientUrl;

  console.log(`[StagingServer] Starting guarded backend on ${config.host}:${config.port}`);
  await import('./server.js');
} catch (error) {
  console.error('[StagingServer] Failed to start:', error.message);
  process.exitCode = 1;
}
