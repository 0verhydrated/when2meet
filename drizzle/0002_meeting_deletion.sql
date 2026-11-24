ALTER TABLE meetings ADD COLUMN delete_password_hash TEXT;
ALTER TABLE meetings ADD COLUMN delete_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN delete_reset_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN deleted_at TEXT;
