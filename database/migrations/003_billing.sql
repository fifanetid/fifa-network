CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
  email TEXT,
  phone TEXT NOT NULL CHECK (length(trim(phone)) BETWEEN 6 AND 30),
  address TEXT NOT NULL CHECK (length(trim(address)) BETWEEN 5 AND 500),
  identity_number TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(full_name);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);

CREATE TABLE IF NOT EXISTS internet_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 100),
  speed_mbps INTEGER NOT NULL CHECK (speed_mbps BETWEEN 1 AND 100000),
  monthly_price_idr INTEGER NOT NULL CHECK (monthly_price_idr >= 0),
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  plan_id INTEGER NOT NULL REFERENCES internet_plans(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  billing_day INTEGER NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 28),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','terminated')),
  external_device_ref TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  billing_period TEXT NOT NULL CHECK (billing_period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date TEXT NOT NULL,
  subtotal_idr INTEGER NOT NULL CHECK (subtotal_idr >= 0),
  discount_idr INTEGER NOT NULL DEFAULT 0 CHECK (discount_idr >= 0),
  total_idr INTEGER NOT NULL CHECK (total_idr >= 0 AND total_idr = subtotal_idr - discount_idr),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','void')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subscription_id, billing_period),
  CHECK (discount_idr <= subtotal_idr)
);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices(status,due_date);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  payment_reference TEXT NOT NULL UNIQUE,
  amount_idr INTEGER NOT NULL CHECK (amount_idr > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank_transfer','qris','other')),
  paid_at TEXT NOT NULL,
  received_by INTEGER REFERENCES users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
