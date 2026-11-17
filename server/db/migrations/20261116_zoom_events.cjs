function ensureZoomEvents(db) {
  return db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS zoom_event_receipts (
      id INTEGER PRIMARY KEY,
      event_fingerprint TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      event_ts INTEGER NOT NULL,
      meeting_id TEXT NOT NULL,
      meeting_instance TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unmatched' CHECK(status IN ('unmatched','processed','rejected')),
      received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_zoom_receipt_participant_time
      ON zoom_event_receipts(meeting_instance, meeting_id, participant_id, occurred_at);
    CREATE TABLE IF NOT EXISTS zoom_class_bindings (
      meeting_instance TEXT PRIMARY KEY NOT NULL,
      meeting_id TEXT NOT NULL,
      batch_id INTEGER NOT NULL,
      phase_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      class_date TEXT NOT NULL,
      bound_by INTEGER NOT NULL,
      bound_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(batch_id, phase_id, slot_id, class_date)
    );
    CREATE TABLE IF NOT EXISTS zoom_participant_verifications (
      meeting_instance TEXT NOT NULL REFERENCES zoom_class_bindings(meeting_instance),
      participant_id TEXT NOT NULL,
      enrollment_id INTEGER NOT NULL,
      class_id TEXT NOT NULL,
      verified_by INTEGER NOT NULL,
      verified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY(meeting_instance, participant_id),
      UNIQUE(meeting_instance, enrollment_id)
    );
    CREATE TABLE IF NOT EXISTS zoom_participant_revocations (
      id INTEGER PRIMARY KEY,
      meeting_instance TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      enrollment_id INTEGER NOT NULL,
      class_id TEXT NOT NULL,
      verified_by INTEGER NOT NULL,
      verified_at TEXT NOT NULL,
      revoked_by INTEGER NOT NULL,
      reason TEXT NOT NULL,
      revoked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`);
    return {applied: db.prepare('INSERT OR IGNORE INTO app_migrations(name) VALUES (?)').run('20261116_zoom_events').changes > 0};
  })();
}
module.exports = {ensureZoomEvents};
