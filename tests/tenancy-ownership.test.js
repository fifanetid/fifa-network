"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-tenant-ownership-"));
process.env.BILLING_DB_PATH = path.join(tempDir, "billing.sqlite");
const { db } = require("../database/db");

test.after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("tenant ownership columns exist on all ISP business tables", () => {
  const tables = [
    "customers", "internet_plans", "subscriptions", "invoices", "payments",
    "payment_reversals", "audit_logs", "whatsapp_message_logs", "app_settings",
    "voucher_packages", "customer_portal_accounts", "customer_payment_confirmations",
    "support_tickets", "support_ticket_messages", "mikrotik_routers",
    "genieacs_device_links", "network_odps", "expense_categories", "expenses",
    "inventory_items", "inventory_movements"
  ];
  for (const table of tables) {
    const columns = db.pragma("table_info(" + table + ")");
    assert.ok(columns.some(column => column.name === "tenant_id"), table + " must have tenant_id");
  }
  assert.equal(db.prepare("SELECT id FROM tenants WHERE slug='fifa-network'").get().id, 1);
});


test("legacy user creation and deletion maintain default tenant membership", () => {
  const userId = db.prepare(
    "INSERT INTO users (name,email,password_hash,role) VALUES ('Tenant Test User','tenant-user@example.test','not-a-real-hash','admin')"
  ).run().lastInsertRowid;
  assert.equal(db.prepare(
    "SELECT COUNT(*) AS total FROM tenant_memberships WHERE user_id=? AND tenant_id=1 AND status='active'"
  ).get(userId).total, 1);
  db.prepare("DELETE FROM users WHERE id=?").run(userId);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM tenant_memberships WHERE user_id=?").get(userId).total, 0);
});

test("new business records default to the legacy FIFA Network tenant", () => {
  const customer = db.prepare(
    "INSERT INTO customers (customer_code,full_name,phone,address) VALUES ('OWN-DEFAULT','Tenant Default','081234567890','Alamat default tenant')"
  ).run();
  const row = db.prepare("SELECT tenant_id FROM customers WHERE id=?").get(customer.lastInsertRowid);
  assert.equal(row.tenant_id, 1);
});

test("database rejects unknown tenants and cross-tenant billing relationships", () => {
  const tenant2 = db.prepare(
    "INSERT INTO tenants (name,slug,status,plan_code) VALUES ('ISP Kedua','isp-kedua','trial','starter')"
  ).run().lastInsertRowid;

  assert.throws(() => db.prepare(
    "INSERT INTO customers (customer_code,full_name,phone,address,tenant_id) VALUES ('OWN-BAD','Tenant Invalid','081234567890','Alamat invalid',99999)"
  ).run(), /unknown tenant/);

  const customer2 = db.prepare(
    "INSERT INTO customers (customer_code,full_name,phone,address,tenant_id) VALUES ('OWN-T2','Pelanggan Tenant Dua','081234567891','Alamat tenant dua',?)"
  ).run(tenant2).lastInsertRowid;
  const plan1 = db.prepare(
    "INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr) VALUES ('OWN-P1','Paket Tenant Satu',10,100000)"
  ).run().lastInsertRowid;

  assert.throws(() => db.prepare(
    "INSERT INTO subscriptions (customer_id,plan_id,start_date,tenant_id) VALUES (?,?,'2026-11-01',?)"
  ).run(customer2, plan1, tenant2), /same tenant/);

  const plan2 = db.prepare(
    "INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr,tenant_id) VALUES ('OWN-P2','Paket Tenant Dua',20,150000,?)"
  ).run(tenant2).lastInsertRowid;
  const subscription2 = db.prepare(
    "INSERT INTO subscriptions (customer_id,plan_id,start_date,tenant_id) VALUES (?,?,'2026-11-01',?)"
  ).run(customer2, plan2, tenant2).lastInsertRowid;

  assert.throws(() => db.prepare(`
    INSERT INTO invoices (invoice_number,subscription_id,customer_id,billing_period,due_date,subtotal_idr,discount_idr,total_idr,tenant_id)
    VALUES ('OWN-INV-BAD',?,?, '2026-11','2026-11-20',150000,0,150000,1)
  `).run(subscription2, customer2), /same tenant/);

  const invoice2 = db.prepare(`
    INSERT INTO invoices (invoice_number,subscription_id,customer_id,billing_period,due_date,subtotal_idr,discount_idr,total_idr,tenant_id)
    VALUES ('OWN-INV-T2',?,?, '2026-11','2026-11-20',150000,0,150000,?)
  `).run(subscription2, customer2, tenant2).lastInsertRowid;

  assert.throws(() => db.prepare(
    "INSERT INTO payments (invoice_id,payment_reference,amount_idr,payment_method,paid_at,tenant_id) VALUES (?,'OWN-PAY-BAD',1000,'cash','2026-11-01',1)"
  ).run(invoice2), /same tenant/);

  const payment2 = db.prepare(
    "INSERT INTO payments (invoice_id,payment_reference,amount_idr,payment_method,paid_at,tenant_id) VALUES (?,'OWN-PAY-T2',1000,'cash','2026-11-01',?)"
  ).run(invoice2, tenant2).lastInsertRowid;

  assert.throws(() => db.prepare(
    "INSERT INTO payment_reversals (payment_id,reversal_reference,amount_idr,reason,tenant_id) VALUES (?,'OWN-REV-BAD',100,'Uji batas tenant',1)"
  ).run(payment2), /same tenant/);
});

test("customer ODP, support ticket and inventory relations cannot cross tenants", () => {
  const tenant2 = db.prepare(
    "INSERT INTO tenants (name,slug,status,plan_code) VALUES ('ISP Relasi','isp-relasi','trial','starter')"
  ).run().lastInsertRowid;
  const odp2 = db.prepare(
    "INSERT INTO network_odps (odp_code,name,tenant_id) VALUES ('OWN-ODP2','ODP Tenant Dua',?)"
  ).run(tenant2).lastInsertRowid;
  assert.throws(() => db.prepare(
    "INSERT INTO customers (customer_code,full_name,phone,address,odp_id) VALUES ('OWN-ODP-BAD','Pelanggan Salah ODP','081234567890','Alamat pelanggan',?)"
  ).run(odp2), /same tenant/);

  const customer1 = db.prepare(
    "INSERT INTO customers (customer_code,full_name,phone,address) VALUES ('OWN-TICKET-1','Pelanggan Tenant Satu','081234567892','Alamat tenant satu')"
  ).run().lastInsertRowid;
  const ticket1 = db.prepare(
    "INSERT INTO support_tickets (ticket_number,customer_id,category,subject) VALUES ('OWN-TICKET-0001',?,'internet','Gangguan internet pelanggan')"
  ).run(customer1).lastInsertRowid;
  assert.throws(() => db.prepare(
    "INSERT INTO support_ticket_messages (ticket_id,sender_type,message,tenant_id) VALUES (?,'system','Pesan lintas tenant',?)"
  ).run(ticket1, tenant2), /same tenant/);

  const item2 = db.prepare(
    "INSERT INTO inventory_items (sku,name,category,tenant_id) VALUES ('OWN-STOCK-2','Kabel Tenant Dua','Kabel',?)"
  ).run(tenant2).lastInsertRowid;
  assert.throws(() => db.prepare(
    "INSERT INTO inventory_movements (item_id,movement_type,quantity,tenant_id) VALUES (?,'in',5,1)"
  ).run(item2), /same tenant/);
});
