require("dotenv").config();
const { db } = require("../database/db");
const billing = require("../modules/billing");

function jakartaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
}

function main(args) {
  const now = jakartaDateParts();
  const period = args[0] || now.year + "-" + now.month;
  const dueDate = args[1] || period + "-10";
  const invoices = billing.generateMonthlyInvoices({ period, dueDate });
  db.prepare(`
    INSERT INTO audit_logs (actor_user_id, actor_name, actor_role, action, entity_type, entity_id, summary)
    VALUES (NULL, 'FF BILLING Scheduler', 'system', 'invoice.batch_create', 'invoice_batch', ?, ?)
  `).run(
    invoices[0] ? String(invoices[0].id) : null,
    "Scheduler menerbitkan " + invoices.length + " invoice untuk periode " + period
  );
  process.stdout.write("Periode " + period + ": " + invoices.length + " invoice baru dibuat.\n");
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write("Gagal menjalankan billing bulanan: " + error.message + "\n");
  process.exitCode = 1;
} finally {
  db.close();
}
