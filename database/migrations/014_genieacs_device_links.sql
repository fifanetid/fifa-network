-- Store references only; device inventory remains owned by GenieACS.
CREATE TABLE IF NOT EXISTS genieacs_device_links (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE RESTRICT,
 genieacs_device_id TEXT NOT NULL UNIQUE,
 serial_number TEXT,
 manufacturer TEXT,
 product_class TEXT,
 linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 linked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 notes TEXT,
 CHECK(length(trim(genieacs_device_id)) BETWEEN 1 AND 200),
 CHECK(serial_number IS NULL OR length(serial_number)<=100),
 CHECK(manufacturer IS NULL OR length(manufacturer)<=100),
 CHECK(product_class IS NULL OR length(product_class)<=100),
 CHECK(notes IS NULL OR length(notes)<=500)
);
CREATE INDEX IF NOT EXISTS idx_genieacs_device_links_customer ON genieacs_device_links(customer_id);
CREATE INDEX IF NOT EXISTS idx_genieacs_device_links_subscription ON genieacs_device_links(subscription_id);
CREATE INDEX IF NOT EXISTS idx_genieacs_device_links_serial ON genieacs_device_links(serial_number);
