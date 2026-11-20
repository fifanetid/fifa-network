"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const bcrypt=require("bcryptjs");

const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"ff-tenant-support-scope-"));
process.env.BILLING_DB_PATH=path.join(tempDir,"tenant-support.sqlite");
process.env.SESSION_SECRET="tenant-support-scope-test-secret-long-enough-123456";
const {db}=require("../../database/db");
const app=require("../../apps/web/app");
const {getReminderPreview}=require("../../modules/whatsapp/reminders");

db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES ('Tenant One Admin','tenant-one-admin@example.test',?,'admin')")
 .run(bcrypt.hashSync("tenant-support-password",4));
const tenant2=db.prepare("INSERT INTO tenants (name,slug,status,plan_code) VALUES ('ISP Support Dua','isp-support-dua','trial','starter')").run().lastInsertRowid;
const customer2=db.prepare("INSERT INTO customers (tenant_id,customer_code,full_name,phone,address,whatsapp_opt_in) VALUES (?, 'CUS-SUPPORT-T2','Pelanggan Rahasia Dua','081234567899','Alamat Dua',1)").run(tenant2).lastInsertRowid;
db.prepare("INSERT INTO customer_portal_accounts (tenant_id,customer_id,password_hash,is_active) VALUES (?,?,?,1)")
 .run(tenant2,customer2,bcrypt.hashSync("portal-tenant-two-password",4));
const ticket2=db.prepare("INSERT INTO support_tickets (tenant_id,ticket_number,customer_id,category,subject) VALUES (?,?,?,?,?)").run(tenant2,"TKT-TENANT-2",customer2,"internet","Tiket rahasia tenant dua").lastInsertRowid;
db.prepare("INSERT INTO support_ticket_messages (tenant_id,ticket_id,sender_type,sender_customer_id,message) VALUES (?,?,'customer',?,'Pesan rahasia dari tenant dua')").run(tenant2,ticket2,customer2);
const plan2=db.prepare("INSERT INTO internet_plans (tenant_id,plan_code,name,speed_mbps,monthly_price_idr) VALUES (?, 'PLAN-WA-T2','Paket WhatsApp Dua',10,100000)").run(tenant2).lastInsertRowid;
const subscription2=db.prepare("INSERT INTO subscriptions (tenant_id,customer_id,plan_id,start_date) VALUES (?,?,?,'2026-11-01')").run(tenant2,customer2,plan2).lastInsertRowid;
db.prepare("INSERT INTO invoices (tenant_id,invoice_number,subscription_id,customer_id,billing_period,due_date,subtotal_idr,discount_idr,total_idr,status) VALUES (?, 'INV-WA-T2',?,?,'2026-11','2026-11-23',100000,0,100000,'unpaid')").run(tenant2,subscription2,customer2);

const server=http.createServer(app);
let baseUrl;
test.before(async()=>{await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));baseUrl="http://127.0.0.1:"+server.address().port;});
test.after(async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();fs.rmSync(tempDir,{recursive:true,force:true});});

function tokenFrom(html){const m=html.match(/name="_csrf"\s+value="([^"]+)"/);assert.ok(m);return m[1];}
function cookieFrom(response,current=""){const value=response.headers.get("set-cookie");return value?value.split(";")[0]:current;}
async function get(pathname,session){const r=await fetch(baseUrl+pathname,{headers:{cookie:session.cookie||""},redirect:"manual"});session.cookie=cookieFrom(r,session.cookie||"");return r;}
async function post(pathname,session,values={}){const r=await fetch(baseUrl+pathname,{method:"POST",redirect:"manual",headers:{"content-type":"application/x-www-form-urlencoded","x-csrf-token":session.token,cookie:session.cookie},body:new URLSearchParams({...values,_csrf:session.token})});session.cookie=cookieFrom(r,session.cookie);return r;}
async function loginStaff(){const session={cookie:""};const page=await get("/login",session);assert.equal(page.status,200);session.token=tokenFrom(await page.text());const r=await post("/login",session,{identifier:"tenant-one-admin@example.test",password:"tenant-support-password"});assert.equal(r.status,302);return session;}
async function loginCustomer(){const session={cookie:""};const page=await get("/customer/login",session);assert.equal(page.status,200);session.token=tokenFrom(await page.text());const r=await post("/customer/login",session,{customer_code:"CUS-SUPPORT-T2",password:"portal-tenant-two-password"});return {session,response:r};}
async function refreshToken(pathname,session){const page=await get(pathname,session);const html=await page.text();assert.equal(page.status,200);session.token=tokenFrom(html);return html;}

test("support staff cannot view, update or reply to a ticket owned by another tenant",async()=>{
 const session=await loginStaff();
 const inbox=await refreshToken("/admin/tickets",session);
 assert.doesNotMatch(inbox,/TKT-TENANT-2|Tiket rahasia tenant dua|Pelanggan Rahasia Dua/);
 const detail=await get("/admin/tickets/"+ticket2,session);
 assert.equal(detail.status,404);
 const update=await post("/admin/tickets/"+ticket2+"/update",session,{status:"in_progress",priority:"high",assigned_to:""});
 assert.equal(update.status,404);
 const reply=await post("/admin/tickets/"+ticket2+"/reply",session,{message:"Tidak boleh membalas tiket tenant lain."});
 assert.equal(reply.status,404);
 assert.equal(db.prepare("SELECT status FROM support_tickets WHERE id=? AND tenant_id=?").get(ticket2,tenant2).status,"open");
});

test("customer portal login is restricted to the default tenant",async()=>{
 const result=await loginCustomer();
 assert.equal(result.response.status,302);
 assert.equal(result.response.headers.get("location"),"/customer/login?error=1");
 const page=await get("/customer",result.session);
 assert.equal(page.status,302);
 assert.equal(page.headers.get("location"),"/customer/login");
});

test("WhatsApp reminder preview only returns invoices owned by the requested tenant",()=>{
 assert.deepEqual(getReminderPreview({today:"2026-11-20",tenantId:1}),[]);
 const rows=getReminderPreview({today:"2026-11-20",tenantId:tenant2});
 assert.equal(rows.length,1);
 assert.equal(rows[0].invoice_number,"INV-WA-T2");
 assert.equal(rows[0].customer_id,customer2);
});
