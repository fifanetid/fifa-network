const { db } = require("../../database/db");

function validDate(value, label) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(label + " tidak valid.");
  const date = new Date(text + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(label + " tidak valid.");
  }
  return text;
}

function getFinancialReport({ from, to }) {
  const start = validDate(from, "Tanggal awal");
  const end = validDate(to, "Tanggal akhir");
  if (start > end) throw new Error("Tanggal awal tidak boleh melewati tanggal akhir.");

  const invoices = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total_idr),0) AS total
    FROM invoices WHERE status <> 'void' AND date(issued_at) BETWEEN ? AND ?
  `).get(start, end);

  const payments = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount_idr),0) AS total
    FROM payments WHERE date(paid_at) BETWEEN ? AND ?
  `).get(start, end);

  const reversals = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount_idr),0) AS total
    FROM payment_reversals WHERE date(reversed_at) BETWEEN ? AND ?
  `).get(start, end);

  const outstanding = db.prepare(`
    SELECT COALESCE(SUM(i.total_idr
      - COALESCE((SELECT SUM(p.amount_idr) FROM payments p WHERE p.invoice_id=i.id),0)
      + COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=i.id),0)
    ),0) AS total
    FROM invoices i WHERE i.status <> 'void'
  `).get().total;

  const overdue = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(i.total_idr
      - COALESCE((SELECT SUM(p.amount_idr) FROM payments p WHERE p.invoice_id=i.id),0)
      + COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=i.id),0)
    ),0) AS total
    FROM invoices i WHERE i.status <> 'void' AND i.due_date < date('now')
      AND i.total_idr > COALESCE((SELECT SUM(p.amount_idr) FROM payments p WHERE p.invoice_id=i.id),0)
        - COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=i.id),0)
  `).get();

  const monthly = db.prepare(`
    SELECT month, SUM(received_idr) AS received_idr, SUM(reversed_idr) AS reversed_idr,
      SUM(received_idr)-SUM(reversed_idr) AS net_idr
    FROM (
      SELECT strftime('%Y-%m', paid_at) AS month, SUM(amount_idr) AS received_idr, 0 AS reversed_idr
      FROM payments WHERE date(paid_at) BETWEEN ? AND ? GROUP BY strftime('%Y-%m', paid_at)
      UNION ALL
      SELECT strftime('%Y-%m', reversed_at) AS month, 0 AS received_idr, SUM(amount_idr) AS reversed_idr
      FROM payment_reversals WHERE date(reversed_at) BETWEEN ? AND ? GROUP BY strftime('%Y-%m', reversed_at)
    ) movements GROUP BY month ORDER BY month DESC
  `).all(start, end, start, end);

  const methods = db.prepare(`
    SELECT payment_method, SUM(received_idr) AS received_idr,
      SUM(reversed_idr) AS reversed_idr,
      SUM(received_idr)-SUM(reversed_idr) AS net_idr
    FROM (
      SELECT payment_method, SUM(amount_idr) AS received_idr, 0 AS reversed_idr
      FROM payments WHERE date(paid_at) BETWEEN ? AND ? GROUP BY payment_method
      UNION ALL
      SELECT p.payment_method, 0 AS received_idr, SUM(r.amount_idr) AS reversed_idr
      FROM payment_reversals r JOIN payments p ON p.id=r.payment_id
      WHERE date(r.reversed_at) BETWEEN ? AND ? GROUP BY p.payment_method
    ) movements GROUP BY payment_method ORDER BY received_idr DESC
  `).all(start, end, start, end);

  return {
    from: start, to: end,
    summary: {
      invoice_count: invoices.count, billed_idr: invoices.total,
      payment_count: payments.count, received_idr: payments.total,
      reversal_count: reversals.count, reversed_idr: reversals.total,
      net_received_idr: payments.total - reversals.total,
      outstanding_idr: outstanding,
      overdue_count: overdue.count, overdue_idr: overdue.total
    },
    monthly, methods
  };
}

module.exports = { getFinancialReport, validDate };
