CREATE TABLE IF NOT EXISTS network_odps (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 odp_code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(odp_code)) BETWEEN 2 AND 40),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 100),
 address TEXT,
 latitude REAL CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
 longitude REAL CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180),
 port_capacity INTEGER NOT NULL DEFAULT 8 CHECK(port_capacity BETWEEN 1 AND 256),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','full','maintenance','inactive')),
 notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_network_odps_status ON network_odps(status,odp_code);
ALTER TABLE customers ADD COLUMN latitude REAL CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE customers ADD COLUMN longitude REAL CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE customers ADD COLUMN odp_id INTEGER REFERENCES network_odps(id) ON UPDATE RESTRICT ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_odp ON customers(odp_id);
CREATE TABLE IF NOT EXISTS expense_categories (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 2 AND 60),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS expenses (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 expense_number TEXT NOT NULL UNIQUE,
 category_id INTEGER REFERENCES expense_categories(id) ON UPDATE RESTRICT ON DELETE SET NULL,
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 240),
 amount_idr INTEGER NOT NULL CHECK(amount_idr > 0),
 expense_date TEXT NOT NULL CHECK(expense_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','bank_transfer','qris','other')),
 vendor TEXT,
 notes TEXT,
 created_by INTEGER REFERENCES users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id,expense_date);
CREATE TABLE IF NOT EXISTS inventory_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sku TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(sku)) BETWEEN 2 AND 40),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 120),
 category TEXT NOT NULL CHECK(length(trim(category)) BETWEEN 2 AND 60),
 unit TEXT NOT NULL DEFAULT 'pcs' CHECK(length(trim(unit)) BETWEEN 1 AND 16),
 quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
 min_quantity INTEGER NOT NULL DEFAULT 0 CHECK(min_quantity >= 0),
 unit_cost_idr INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_idr >= 0),
 location TEXT,
 notes TEXT,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON inventory_items(is_active,quantity,min_quantity);
CREATE TABLE IF NOT EXISTS inventory_movements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 movement_type TEXT NOT NULL CHECK(movement_type IN ('in','out','adjustment')),
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 reference TEXT,
 notes TEXT,
 created_by INTEGER REFERENCES users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(item_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_inventory_movement_apply
AFTER INSERT ON inventory_movements
BEGIN
 UPDATE inventory_items SET quantity =
  CASE NEW.movement_type WHEN 'in' THEN quantity + NEW.quantity
   WHEN 'out' THEN quantity - NEW.quantity ELSE NEW.quantity END,
  updated_at=CURRENT_TIMESTAMP
 WHERE id=NEW.item_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_inventory_no_negative
BEFORE INSERT ON inventory_movements
WHEN (SELECT quantity FROM inventory_items WHERE id=NEW.item_id) IS NULL
 OR (NEW.movement_type='out' AND (SELECT quantity FROM inventory_items WHERE id=NEW.item_id)<NEW.quantity)
BEGIN
 SELECT RAISE(ABORT,'stok tidak mencukupi atau item tidak ditemukan');
END;
CREATE TRIGGER IF NOT EXISTS trg_inventory_movement_immutable_update
BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'inventory movement is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_inventory_movement_immutable_delete
BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT,'inventory movement is immutable'); END;
