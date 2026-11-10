-- Keep invoice ownership aligned with its subscription and enforce payment totals
-- at the database boundary, including writes outside the web request handlers.
CREATE TRIGGER IF NOT EXISTS trg_invoice_customer_matches_subscription_insert
BEFORE INSERT ON invoices
WHEN NEW.customer_id <> (SELECT customer_id FROM subscriptions WHERE id = NEW.subscription_id)
BEGIN
  SELECT RAISE(ABORT, 'invoice customer must match subscription customer');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_customer_matches_subscription_update
BEFORE UPDATE OF customer_id, subscription_id ON invoices
WHEN NEW.customer_id <> (SELECT customer_id FROM subscriptions WHERE id = NEW.subscription_id)
BEGIN
  SELECT RAISE(ABORT, 'invoice customer must match subscription customer');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_guard_insert
BEFORE INSERT ON payments
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) IS NULL
      THEN RAISE(ABORT, 'invoice does not exist')
    WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) = 'void'
      THEN RAISE(ABORT, 'cannot pay a void invoice')
    WHEN COALESCE((SELECT SUM(amount_idr) FROM payments WHERE invoice_id = NEW.invoice_id), 0) + NEW.amount_idr
      > (SELECT total_idr FROM invoices WHERE id = NEW.invoice_id)
      THEN RAISE(ABORT, 'payment exceeds invoice total')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_sync_invoice_status
AFTER INSERT ON payments
BEGIN
  UPDATE invoices
  SET status = CASE
    WHEN (SELECT COALESCE(SUM(amount_idr), 0) FROM payments WHERE invoice_id = NEW.invoice_id) >= total_idr THEN 'paid'
    WHEN (SELECT COALESCE(SUM(amount_idr), 0) FROM payments WHERE invoice_id = NEW.invoice_id) > 0 THEN 'partial'
    ELSE 'unpaid'
  END
  WHERE id = NEW.invoice_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_payments_no_update
BEFORE UPDATE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payment records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_payments_no_delete
BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payment records are immutable');
END;
