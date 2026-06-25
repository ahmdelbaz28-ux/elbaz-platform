import { getDb } from './api/queries/connection.js';
import { sql } from 'drizzle-orm';

async function fixSchema() {
  const db = getDb();
  
  const cols = [
    "ADD COLUMN passwordResetToken varchar(255)",
    "ADD COLUMN passwordResetExpiresAt timestamp",
    "ADD COLUMN emailVerificationToken varchar(255)",
    "ADD COLUMN emailVerificationExpiry timestamp",
    "ADD COLUMN emailVerifiedAt timestamp",
    "ADD COLUMN pendingEmail varchar(320)",
    "ADD COLUMN totpSecret varchar(255)",
    "ADD COLUMN totpEnabled boolean NOT NULL DEFAULT false",
    "ADD COLUMN totpBackupCodes json",
    "ADD COLUMN deviceFingerprint varchar(255)"
  ];

  for (const col of cols) {
    try {
      await db.execute(sql.raw(`ALTER TABLE users ${col};`));
      console.log(`✅ ${col}`);
    } catch (err: any) {
      console.log(`⚠️ Failed ${col}: ${err.message || String(err)}`);
    }
  }
  process.exit(0);
}
fixSchema();
