"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const Database=require("better-sqlite3");

test("tenant migrations backfill an existing single-ISP database to FIFA Network",()=>{
 const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"ff-tenant-backfill-"));
 const legacyPath=path.join(tempDir,"legacy.sqlite");
 const legacy=new Database(legacyPath);
 try {
  legacy.pragma("foreign_keys=ON");
  legacy.exec(`CREATE TABLE schema_migrations (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   filename TEXT NOT NULL UNIQUE,
   applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const migrationsDir=path.join(__dirname,"../../database/migrations");
  const files=fs.readdirSync(migrationsDir).filter(name=>name.endsWith(".sql")).sort();
  const beforeTenant=files.filter(name=>Number(name.slice(0,3))<=15);
  const tenantMigrations=files.filter(name=>Number(name.slice(0,3))>=16);
  for(const filename of beforeTenant) {
   const sql=fs.readFileSync(path.join(migrationsDir,filename),"utf8");
   legacy.transaction(()=>{
    legacy.exec(sql);
    legacy.prepare("INSERT INTO schema_migrations(filename) VALUES (?)").run(filename);
   })();
  }

  const userId=legacy.prepare(
   "INSERT INTO users (name,email,password_hash,role) VALUES ('Legacy Admin','legacy-admin@example.test','legacy-hash','admin')"
  ).run().lastInsertRowid;
  const customerId=legacy.prepare(
   "INSERT INTO customers (customer_code,full_name,phone,address) VALUES ('LEGACY-CUS-001','Pelanggan Lama','081234567890','Alamat pelanggan lama')"
  ).run().lastInsertRowid;
  const planId=legacy.prepare(
   "INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr) VALUES ('LEGACY-PLAN-10','Paket Lama 10 Mbps',10,100000)"
  ).run().lastInsertRowid;
  const subscriptionId=legacy.prepare(
   "INSERT INTO subscriptions (customer_id,plan_id,start_date) VALUES (?,?,'2026-01-01')"
  ).run(customerId,planId).lastInsertRowid;

  for(const filename of tenantMigrations) {
   const sql=fs.readFileSync(path.join(migrationsDir,filename),"utf8");
   legacy.transaction(()=>{
    legacy.exec(sql);
    legacy.prepare("INSERT INTO schema_migrations(filename) VALUES (?)").run(filename);
   })();
  }

  const defaultTenant=legacy.prepare("SELECT id,name,slug FROM tenants WHERE slug='fifa-network'").get();
  assert.ok(defaultTenant);
  assert.equal(defaultTenant.id,1);
  assert.equal(legacy.prepare("SELECT tenant_id FROM customers WHERE id=?").get(customerId).tenant_id,1);
  assert.equal(legacy.prepare("SELECT tenant_id FROM internet_plans WHERE id=?").get(planId).tenant_id,1);
  assert.equal(legacy.prepare("SELECT tenant_id FROM subscriptions WHERE id=?").get(subscriptionId).tenant_id,1);
  assert.ok(legacy.prepare("SELECT id FROM tenant_memberships WHERE tenant_id=1 AND user_id=? AND role='admin' AND status='active'").get(userId));

  const tenant2=legacy.prepare("INSERT INTO tenants (name,slug,status,plan_code) VALUES ('ISP Baru','isp-baru','trial','starter')").run().lastInsertRowid;
  assert.throws(()=>legacy.prepare(
   "INSERT INTO customers (tenant_id,customer_code,full_name,phone,address) VALUES (?,'LEGACY-CUS-001','Pelanggan Kedua','081234567891','Alamat pelanggan kedua')"
  ).run(tenant2),/UNIQUE constraint failed/);
  assert.throws(()=>legacy.prepare("UPDATE customers SET tenant_id=? WHERE id=?").run(tenant2,customerId),/tenant ownership is immutable/);

  const newUser=legacy.prepare(
   "INSERT INTO users (name,email,password_hash,role) VALUES ('New Legacy User','new-legacy-user@example.test','hash','teknisi')"
  ).run().lastInsertRowid;
  assert.ok(legacy.prepare("SELECT id FROM tenant_memberships WHERE tenant_id=1 AND user_id=? AND role='teknisi' AND status='active'").get(newUser));
 } finally {
  legacy.close();
  fs.rmSync(tempDir,{recursive:true,force:true});
 }
});
