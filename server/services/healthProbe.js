/**
 * server/services/healthProbe.js
 *
 * Lightweight, isolated database readiness probe for HTTP gateway readiness checks.
 */

let cachedDb = null;
let healthStmt = null;

export function probeHealth(dbHandle) {
  try {
    if (!dbHandle) throw new Error('No database handle provided');
    if (cachedDb !== dbHandle) {
      cachedDb = dbHandle;
      healthStmt = dbHandle.prepare('SELECT 1');
    }
    healthStmt.get();
    return { status: 200, body: { status: 'ok', timestamp: Date.now() } };
  } catch {
    return { status: 503, body: { status: 'degraded', error: 'Database unreachable', timestamp: Date.now() } };
  }
}

export function resetHealthProbe() {
  cachedDb = null;
  healthStmt = null;
}
