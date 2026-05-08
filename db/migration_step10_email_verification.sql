ALTER TABLE users ADD COLUMN emailVerifiedAt TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN emailVerificationToken VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN emailVerificationExpiresAt TIMESTAMP NULL;

CREATE INDEX idx_users_email_verification_token ON users(emailVerificationToken);
