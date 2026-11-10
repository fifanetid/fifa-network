-- Replace the payment guard so new receipts use the net balance after reversals.
DROP TRIGGER IF EXISTS trg_payment_guard_insert;

CREATE TRIGGER trg_payment_guard_insert
BEFORE INSERT ON payments
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) IS NULL
      THEN RAISE(ABORT, 'invoice does not exist')
    WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) = 'void'
      THEN RAISE(ABORT, 'cannot pay a void invoice')
    WHEN
      COALESCE((SELECT SUM(amount_idr) FROM payments WHERE invoice_id = NEW.invoice_id), 0)
      - COALESCE((
        SELECT SUM(r.amount_idr)
        FROM payment_reversals r
        JOIN payments p ON p.id = r.payment_id
        WHERE p.invoice_id = NEW.invoice_id
      ), 0)
      + NEW.amount_idr
      > (SELECT total_idr FROM invoices WHERE id = NEW.invoice_id)
      THEN RAISE(ABORT, 'payment exceeds invoice total')
  END;
END;
