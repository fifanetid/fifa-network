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

function getFinancialReport({ from, to, tenantId = 1 }) {
  const tenant = Number(tenantId);
  if (!Number.isSafeInteger(tenant) || tenant < 1) throw new Error("Tenant tidak valid.");
  const start = validDate(from, "Tanggal awal");
  const end = validDate(to, "Tanggal akhir");
  if (start > end) throw new Error("Tanggal awal tidak boleh melewati tanggal akhir.");

  const invoices = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(total_idr),0) AS total
    FROM invoices WHERE tenant_id=? AND status <> 'void' AND date(issued_at) BETWEEN ? AND ?
  `).get(tenant,start,end);

  const payments = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount_idr),0) AS total
    FROM payments WHERE tenant_id=? AND date(paid_at) BETWEEN ? AND ?
  `).get(tenant,start,end);

  const reversals = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount_idr),0) AS total
    FROM payment_reversals WHERE tenant_id=? AND date(reversed_at) BETWEEN ? AND ?
  `).get(tenant,start,end);

  const outstanding = db.prepare(`
    SELECT COALESCE(SUM(i.total_idr
      - COALESCE((SELECT SUM(p.amount_idr) FROM payments p WHERE p.invoice_id=i.id),0)
      + COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=i.id),0)
    ),0) AS total
    FROM invoices i WHERE i.tenant_id=? AND i.status <> 'void'
  `).get(tenant).total;

  const overdue = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(i.total_idr
      - COALESCE((SELECT SUM(p.amount_idr) FROM payments p WHERE p.invoice_id=i.id),0)
      + COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=i.id),0)
    ),0) AS total
    FROM invoices i WHERE i.tenant_id=? AND i.status <> 'void' AND i.due_date < date('now')
      AND i.total_idr > COALESCE((SELECT SUM(p.amount_idr) FROM payments p WHERE p.invoice_id=i.id),0)
        - COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r JOIN payments rp ON rp.id=r.payment_id WHERE rp.invoice_id=i.id),0)
  `).get(tenant);

  const monthly = db.prepare(`
    SELECT month, SUM(received_idr) AS received_idr, SUM(reversed_idr) AS reversed_idr,
      SUM(received_idr)-SUM(reversed_idr) AS net_idr
    FROM (
      SELECT strftime('%Y-%m', paid_at) AS month, SUM(amount_idr) AS received_idr, 0 AS reversed_idr
      FROM payments WHERE tenant_id=? AND date(paid_at) BETWEEN ? AND ? GROUP BY strftime('%Y-%m', paid_at)
      UNION ALL
      SELECT strftime('%Y-%m', reversed_at) AS month, 0 AS received_idr, SUM(amount_idr) AS reversed_idr
      FROM payment_reversals WHERE tenant_id=? AND date(reversed_at) BETWEEN ? AND ? GROUP BY strftime('%Y-%m', reversed_at)
    ) movements GROUP BY month ORDER BY month DESC
  `).all(tenant,start,end,tenant,start,end);

  const methods = db.prepare(`
    SELECT payment_method, SUM(received_idr) AS received_idr,
      SUM(reversed_idr) AS reversed_idr,
      SUM(received_idr)-SUM(reversed_idr) AS net_idr
    FROM (
      SELECT payment_method, SUM(amount_idr) AS received_idr, 0 AS reversed_idr
      FROM payments WHERE tenant_id=? AND date(paid_at) BETWEEN ? AND ? GROUP BY payment_method
      UNION ALL
      SELECT p.payment_method, 0 AS received_idr, SUM(r.amount_idr) AS reversed_idr
      FROM payment_reversals r JOIN payments p ON p.id=r.payment_id AND p.tenant_id=r.tenant_id
      WHERE r.tenant_id=? AND date(r.reversed_at) BETWEEN ? AND ? GROUP BY p.payment_method
    ) movements GROUP BY payment_method ORDER BY received_idr DESC
  `).all(tenant,start,end,tenant,start,end);

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
