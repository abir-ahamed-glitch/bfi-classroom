import { EventEmitter } from 'events';

/**
 * Global Security Events Emitter
 * Dispatches real-time session invalidation, user deactivation, and socket disconnects.
 */
export const securityEvents = new EventEmitter();
