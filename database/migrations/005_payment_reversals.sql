-- Payment corrections are recorded as immutable reversal entries; original payments remain intact.
CREATE TABLE IF NOT EXISTS payment_reversals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  reversal_reference TEXT NOT NULL UNIQUE,
  amount_idr INTEGER NOT NULL CHECK (amount_idr > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 500),
  reversed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(id) ON UPDATE RESTRICT ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_reversals_payment ON payment_reversals(payment_id);

CREATE TRIGGER IF NOT EXISTS trg_payment_reversal_guard_insert
BEFORE INSERT ON payment_reversals
BEGIN
  SELECT CASE
    WHEN (SELECT id FROM payments WHERE id = NEW.payment_id) IS NULL
      THEN RAISE(ABORT, 'payment does not exist')
    WHEN (SELECT i.status FROM invoices i JOIN payments p ON p.invoice_id=i.id WHERE p.id=NEW.payment_id) = 'void'
      THEN RAISE(ABORT, 'cannot reverse payment on a void invoice')
    WHEN COALESCE((SELECT SUM(amount_idr) FROM payment_reversals WHERE payment_id=NEW.payment_id),0) + NEW.amount_idr
      > (SELECT amount_idr FROM payments WHERE id=NEW.payment_id)
      THEN RAISE(ABORT, 'reversal exceeds original payment')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_reversal_sync_invoice
AFTER INSERT ON payment_reversals
BEGIN
  UPDATE invoices
  SET status = CASE
    WHEN status = 'void' THEN 'void'
    WHEN
      (SELECT COALESCE(SUM(p.amount_idr),0) FROM payments p WHERE p.invoice_id=invoices.id)
      - (SELECT COALESCE(SUM(r.amount_idr),0) FROM payment_reversals r JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=invoices.id)
      >= total_idr THEN 'paid'
    WHEN
      (SELECT COALESCE(SUM(p.amount_idr),0) FROM payments p WHERE p.invoice_id=invoices.id)
      - (SELECT COALESCE(SUM(r.amount_idr),0) FROM payment_reversals r JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=invoices.id)
      > 0 THEN 'partial'
    ELSE 'unpaid'
  END
  WHERE id = (SELECT invoice_id FROM payments WHERE id=NEW.payment_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_reversals_no_update
BEFORE UPDATE ON payment_reversals
BEGIN
  SELECT RAISE(ABORT, 'payment reversal records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_reversals_no_delete
BEFORE DELETE ON payment_reversals
BEGIN
  SELECT RAISE(ABORT, 'payment reversal records are immutable');
END;
