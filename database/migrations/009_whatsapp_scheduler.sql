CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY CHECK (length(setting_key) BETWEEN 1 AND 100),
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id) ON UPDATE RESTRICT ON DELETE SET NULL
);

INSERT OR IGNORE INTO app_settings (setting_key, setting_value)
VALUES ('whatsapp_reminders_enabled', '0');

CREATE TABLE IF NOT EXISTS whatsapp_job_locks (
  lock_key TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_job_locks_expires
ON whatsapp_job_locks(expires_at);
