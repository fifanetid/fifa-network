CREATE TABLE IF NOT EXISTS customer_portal_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL UNIQUE REFERENCES customers(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_customer_portal_active
ON customer_portal_accounts(is_active, customer_id);

CREATE TABLE IF NOT EXISTS customer_payment_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  amount_idr INTEGER NOT NULL CHECK (amount_idr > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('bank_transfer','qris','other')),
  payment_reference TEXT NOT NULL UNIQUE CHECK (length(trim(payment_reference)) BETWEEN 3 AND 100),
  paid_at TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by INTEGER REFERENCES users(id) ON UPDATE RESTRICT ON DELETE SET NULL,
  reviewed_at TEXT,
  review_note TEXT,
  payment_id INTEGER UNIQUE REFERENCES payments(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_payment_confirmations_status
ON customer_payment_confirmations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_payment_confirmations_customer
ON customer_payment_confirmations(customer_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_customer_confirmation_invoice_owner_insert
BEFORE INSERT ON customer_payment_confirmations
WHEN NEW.customer_id <> (SELECT customer_id FROM invoices WHERE id=NEW.invoice_id)
BEGIN
  SELECT RAISE(ABORT, 'payment confirmation customer must match invoice customer');
END;

CREATE TRIGGER IF NOT EXISTS trg_customer_confirmation_immutable_after_review
BEFORE UPDATE ON customer_payment_confirmations
WHEN OLD.status <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'reviewed payment confirmations are immutable');
END;
