CREATE TABLE IF NOT EXISTS voucher_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_code TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(trim(package_code)) BETWEEN 2 AND 30),
  name TEXT NOT NULL
    CHECK (length(trim(name)) BETWEEN 2 AND 100),
  validity_value INTEGER NOT NULL CHECK (validity_value BETWEEN 1 AND 8760),
  validity_unit TEXT NOT NULL CHECK (validity_unit IN ('hours','days')),
  quota_mb INTEGER CHECK (quota_mb IS NULL OR quota_mb BETWEEN 1 AND 1048576),
  speed_mbps INTEGER CHECK (speed_mbps IS NULL OR speed_mbps BETWEEN 1 AND 100000),
  price_idr INTEGER NOT NULL CHECK (price_idr >= 0),
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_voucher_packages_active
ON voucher_packages(is_active, package_code COLLATE NOCASE);
