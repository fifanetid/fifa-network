"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const bcrypt=require("bcryptjs");

const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"ff-tenant-billing-scope-"));
process.env.BILLING_DB_PATH=path.join(tempDir,"tenant-billing.sqlite");
process.env.SESSION_SECRET="tenant-billing-scope-test-secret-long-enough-123456";
const {db}=require("../../database/db");
const app=require("../../apps/web/app");

const adminId=db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')")
 .run("Billing Tenant Admin","billing-tenant-admin@example.test",bcrypt.hashSync("billing-tenant-password",4)).lastInsertRowid;
const tenant2=db.prepare("INSERT INTO tenants (name,slug,status,plan_code) VALUES ('ISP Billing Dua','isp-billing-dua','trial','starter')").run().lastInsertRowid;
const customer2=db.prepare("INSERT INTO customers (tenant_id,customer_code,full_name,phone,address) VALUES (?, 'CUS-BILL-T2','Rahasia Pelanggan Dua','081234567890','Alamat Tenant Dua')").run(tenant2).lastInsertRowid;
const plan2=db.prepare("INSERT INTO internet_plans (tenant_id,plan_code,name,speed_mbps,monthly_price_idr) VALUES (?, 'PLAN-BILL-T2','Paket Rahasia Dua',20,150000)").run(tenant2).lastInsertRowid;
const subscription2=db.prepare("INSERT INTO subscriptions (tenant_id,customer_id,plan_id,start_date) VALUES (?,?,?,'2026-11-01')").run(tenant2,customer2,plan2).lastInsertRowid;
const invoice2=db.prepare(`INSERT INTO invoices (tenant_id,invoice_number,subscription_id,customer_id,billing_period,due_date,subtotal_idr,discount_idr,total_idr)
 VALUES (?,?,?,?, '2026-11','2026-11-30',150000,0,150000)`).run(tenant2,"INV-BILL-T2",subscription2,customer2).lastInsertRowid;
db.prepare("INSERT INTO payments (tenant_id,invoice_id,payment_reference,amount_idr,payment_method,paid_at) VALUES (?,?,'PAY-BILL-T2',1000,'cash','2026-11-02')").run(tenant2,invoice2);
db.prepare("INSERT INTO audit_logs (tenant_id,actor_name,actor_role,action,entity_type,entity_id,summary) VALUES (?,'Tenant Dua Admin','admin','secret.action','customer','2','AUDIT-RAHASIA-TENANT-DUA')").run(tenant2);

const server=http.createServer(app);
let baseUrl;
test.before(async()=>{await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));baseUrl="http://127.0.0.1:"+server.address().port;});
test.after(async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();fs.rmSync(tempDir,{recursive:true,force:true});});

function tokenFrom(html){const m=html.match(/name="_csrf"\s+value="([^"]+)"/);assert.ok(m,"CSRF token must exist");return m[1];}
function cookieFrom(response,current=""){const value=response.headers.get("set-cookie");return value?value.split(";")[0]:current;}
async function get(pathname,session,redirect="follow"){const r=await fetch(baseUrl+pathname,{headers:{cookie:session.cookie||""},redirect});session.cookie=cookieFrom(r,session.cookie||"");return r;}
async function post(pathname,session,values={}){const r=await fetch(baseUrl+pathname,{method:"POST",redirect:"manual",headers:{"content-type":"application/x-www-form-urlencoded","x-csrf-token":session.token,cookie:session.cookie},body:new URLSearchParams({...values,_csrf:session.token})});session.cookie=cookieFrom(r,session.cookie);return r;}
async function login(){const session={cookie:""};const page=await get("/login",session);assert.equal(page.status,200);session.token=tokenFrom(await page.text());const response=await post("/login",session,{identifier:"billing-tenant-admin@example.test",password:"billing-tenant-password"});assert.equal(response.status,302);return session;}
async function refreshToken(pathname,session){const page=await get(pathname,session);assert.equal(page.status,200);const html=await page.text();session.token=tokenFrom(html);return html;}

test("billing, dashboard, reports and audit views hide records from another tenant",async()=>{
 const session=await login();
 const billingHtml=await refreshToken("/billing",session);
 assert.doesNotMatch(billingHtml,/Rahasia Pelanggan Dua|PLAN-BILL-T2|INV-BILL-T2|PAY-BILL-T2/);
 const dashboardHtml=await refreshToken("/",session);
 assert.doesNotMatch(dashboardHtml,/Rahasia Pelanggan Dua/);
 const reportHtml=await refreshToken("/reports",session);
 assert.doesNotMatch(reportHtml,/INV-BILL-T2|PAY-BILL-T2/);
 const auditHtml=await refreshToken("/admin/audit",session);
 assert.doesNotMatch(auditHtml,/AUDIT-RAHASIA-TENANT-DUA|Tenant Dua Admin/);
});

test("tenant one cannot edit customer, pay invoice or void invoice owned by tenant two",async()=>{
 const session=await login();
 await refreshToken("/billing",session);
 const edit=await post("/billing/customers/"+customer2+"/update",session,{
  customer_code:"CUS-CHANGED",full_name:"Tidak Boleh Diubah",phone:"081234567891",address:"Alamat yang tidak boleh berubah"
 });
 assert.equal(edit.status,404);
 await refreshToken("/billing",session);
 const payment=await post("/billing/invoices/"+invoice2+"/payments",session,{
  amount_idr:"1000",payment_method:"cash",paid_at:"2026-11-03"
 });
 assert.equal(payment.status,400);
 await refreshToken("/billing",session);
 const voided=await post("/billing/invoices/"+invoice2+"/void",session);
 assert.equal(voided.status,404);
 assert.equal(db.prepare("SELECT full_name FROM customers WHERE id=? AND tenant_id=?").get(customer2,tenant2).full_name,"Rahasia Pelanggan Dua");
 assert.equal(db.prepare("SELECT COUNT(*) AS total FROM payments WHERE invoice_id=? AND tenant_id=?").get(invoice2,tenant2).total,1);
 assert.equal(db.prepare("SELECT status FROM invoices WHERE id=? AND tenant_id=?").get(invoice2,tenant2).status,"partial");
});
