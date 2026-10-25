/**
 * Emergency Super Admin MFA Recovery Script
 * 
 * Usage:
 *   node scripts/reset_super_admin_mfa.cjs [--db path/to/database.db]
 * 
 * Purpose:
 *   Allows the verified host server / database owner to reset Multi-Factor
 *   Authentication (TOTP) for Super Admin (User ID 1, admin@abir) in the event
 *   of a device loss or recovery code exhaustion, preventing permanent lockout.
 */

const Database = require('better-sqlite3');
const path = require('path');

const args = process.argv.slice(2);
let dbPath = path.join(__dirname, '..', 'server', 'bfi_classroom.db');

const dbFlagIndex = args.indexOf('--db');
if (dbFlagIndex !== -1 && args[dbFlagIndex + 1]) {
  dbPath = path.resolve(args[dbFlagIndex + 1]);
}

console.log(`[Emergency MFA Recovery] Connecting to database: ${dbPath}`);

const db = new Database(dbPath);

try {
  const superAdmin = db.prepare('SELECT id, username, email, two_factor_enabled FROM users WHERE id = 1').get();

  if (!superAdmin) {
    console.error('[Error] Super Admin account with ID 1 does not exist in this database.');
    process.exit(1);
  }

  if (superAdmin.username !== 'admin@abir') {
    console.error(`[Error] User ID 1 username is '${superAdmin.username}', expected 'admin@abir'. Aborting.`);
    process.exit(1);
  }

  console.log(`[Target] Super Admin: ${superAdmin.username} (${superAdmin.email})`);
  console.log(`[Current Status] MFA Enabled: ${Boolean(superAdmin.two_factor_enabled)}`);

  const resetTx = db.transaction(() => {
    // 1. Clear MFA credentials from user record
    db.prepare(`
      UPDATE users 
      SET two_factor_secret = NULL,
          pending_two_factor_secret = NULL,
          two_factor_enabled = 0,
          last_totp_timestamp = 0,
          updated_at = datetime('now')
      WHERE id = 1
    `).run();

    // 2. Remove any stored recovery codes
    db.prepare('DELETE FROM admin_mfa_recovery_codes WHERE user_id = 1').run();

    // 3. Increment token_version to invalidate existing sessions & outstanding challenges
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = 1').run();
    db.prepare('DELETE FROM sessions WHERE user_id = 1').run();
    try {
      db.prepare("UPDATE mfa_login_challenges SET consumed = 1, consumed_at = datetime('now') WHERE user_id = 1 AND consumed = 0").run();
    } catch { /* ignore if table does not exist yet */ }

    // 4. Record security audit log
    db.prepare(`
      INSERT INTO admin_audit_logs (actor_id, target_user_id, action, details, ip_address)
      VALUES (1, 1, 'mfa_emergency_reset', ?, '127.0.0.1')
    `).run(JSON.stringify({ reason: 'Owner local emergency MFA recovery CLI executed' }));
  });

  resetTx();

  console.log('✅ Super Admin MFA successfully reset.');
  console.log('   - two_factor_enabled set to 0');
  console.log('   - two_factor_secret cleared');
  console.log('   - Recovery codes removed');
  console.log('   - Active sessions revoked for security');
  console.log('   Abir Ahmad can now log in with standard username & password and re-enroll MFA.');
} catch (err) {
  console.error('[Emergency Recovery Failure]:', err.message);
  process.exit(1);
} finally {
  db.close();
}
