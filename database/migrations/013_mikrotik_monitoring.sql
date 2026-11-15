CREATE TABLE IF NOT EXISTS mikrotik_routers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  router_name TEXT NOT NULL
    CHECK (length(trim(router_name)) BETWEEN 2 AND 80),
  host TEXT NOT NULL
    CHECK (length(trim(host)) BETWEEN 7 AND 45),
  api_port INTEGER NOT NULL CHECK (api_port IN (8728,8729)),
  api_tls INTEGER NOT NULL DEFAULT 0 CHECK (api_tls IN (0,1)),
  api_tls_ca_encrypted TEXT,
  api_username TEXT NOT NULL
    CHECK (length(trim(api_username)) BETWEEN 1 AND 64),
  api_password_encrypted TEXT NOT NULL
    CHECK (length(api_password_encrypted) BETWEEN 32 AND 2000),
  connection_status TEXT NOT NULL DEFAULT 'not_tested'
    CHECK (connection_status IN ('not_tested','connected','failed')),
  router_identity TEXT,
  router_version TEXT,
  router_uptime TEXT,
  cpu_load INTEGER CHECK (cpu_load IS NULL OR cpu_load BETWEEN 0 AND 100),
  cpu_count INTEGER CHECK (cpu_count IS NULL OR cpu_count >= 0),
  memory_free_bytes INTEGER CHECK (memory_free_bytes IS NULL OR memory_free_bytes >= 0),
  memory_total_bytes INTEGER CHECK (memory_total_bytes IS NULL OR memory_total_bytes >= 0),
  active_ppp_count INTEGER NOT NULL DEFAULT 0 CHECK (active_ppp_count >= 0),
  active_ppp_json TEXT NOT NULL DEFAULT '[]',
  last_checked_at TEXT,
  last_error TEXT,
  created_by INTEGER REFERENCES users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(host,api_port)
);

CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_status
ON mikrotik_routers(connection_status,router_name COLLATE NOCASE);
