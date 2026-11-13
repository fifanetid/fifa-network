const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-wa-preview-test-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "preview.sqlite");

const { db } = require("../database/db");
const { getReminderPreview } = require("../modules/whatsapp/reminders");

function addCustomer({ code, name, phone, optIn = 1, status = "active" }) {
  return db.prepare(`
    INSERT INTO customers (customer_code,full_name,phone,address,status,whatsapp_opt_in)
    VALUES (?,?,?,?,?,?)
  `).run(code, name, phone, "Alamat pengujian", status, optIn).lastInsertRowid;
}

function addInvoice({ customerId, dueDate, period, invoiceNumber }) {
  const planId = db.prepare(`
    INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr)
    VALUES (?,?,?,?)
  `).run("P-" + invoiceNumber, "Paket uji", 10, 100000).lastInsertRowid;
  const subscriptionId = db.prepare(`
    INSERT INTO subscriptions (customer_id,plan_id,start_date,status)
    VALUES (?,?,?,'active')
  `).run(customerId, planId, "2026-01-01").lastInsertRowid;
  return db.prepare(`
    INSERT INTO invoices
      (invoice_number,subscription_id,customer_id,billing_period,due_date,subtotal_idr,discount_idr,total_idr,status)
    VALUES (?,?,?,?,?,100000,0,100000,'unpaid')
  `).run(invoiceNumber, subscriptionId, customerId, period, dueDate).lastInsertRowid;
}

test("pratinjau mengikuti persetujuan, status pelanggan, saldo, tahap, dan anti-duplikasi", () => {
  const optedIn = addCustomer({ code: "C-001", name: "Pelanggan Aktif", phone: "081234567890" });
  const optOut = addCustomer({ code: "C-002", name: "Pelanggan Tanpa Izin", phone: "081234567891", optIn: 0 });
  const inactive = addCustomer({ code: "C-003", name: "Pelanggan Nonaktif", phone: "081234567892", status: "inactive" });

  const dueInvoice = addInvoice({
    customerId: optedIn, dueDate: "2026-11-13", period: "2026-11", invoiceNumber: "INV-DUE"
  });
  addInvoice({
    customerId: optedIn, dueDate: "2026-11-16", period: "2026-12", invoiceNumber: "INV-H3"
  });
  addInvoice({
    customerId: optOut, dueDate: "2026-11-13", period: "2026-11", invoiceNumber: "INV-OPTOUT"
  });
  addInvoice({
    customerId: inactive, dueDate: "2026-11-13", period: "2026-11", invoiceNumber: "INV-INACTIVE"
  });

  const preview = getReminderPreview({ today: "2026-11-13" });
  assert.equal(preview.length, 2);
  assert.deepEqual(
    preview.map(item => [item.invoice_number, item.stage_label, item.delivery_status]),
    [
      ["INV-DUE", "Jatuh tempo", "ready"],
      ["INV-H3", "H-3", "ready"]
    ]
  );
  assert.equal(preview[0].remaining_idr, 100000);
  assert.equal(preview[0].will_send, true);

  db.prepare(`
    INSERT INTO whatsapp_message_logs
      (customer_id,invoice_id,phone,message_type,dedupe_key,status)
    VALUES (?,?,?,'reminder',?,'sent')
  `).run(optedIn, dueInvoice, "081234567890", dueInvoice + ":due");

  const refreshed = getReminderPreview({ today: "2026-11-13" });
  const dueItem = refreshed.find(item => item.invoice_number === "INV-DUE");
  assert.equal(dueItem.delivery_status, "already_sent");
  assert.equal(dueItem.will_send, false);

  db.prepare("UPDATE invoices SET status='paid' WHERE id=?").run(dueInvoice);
  assert.equal(
    getReminderPreview({ today: "2026-11-13" }).some(item => item.invoice_number === "INV-DUE"),
    false
  );
});

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
