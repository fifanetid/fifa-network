"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const bcrypt=require("bcryptjs");

const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"ff-tenant-user-plan-"));
process.env.BILLING_DB_PATH=path.join(tempDir,"tenant-user-plan.sqlite");
process.env.SESSION_SECRET="tenant-user-plan-test-secret-long-enough-123456";
const {db}=require("../../database/db");
const app=require("../../apps/web/app");

db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES ('Tenant One Admin','tenant-one-plan-admin@example.test',?,'admin')")
 .run(bcrypt.hashSync("tenant-user-plan-password",4));
const tenant2=db.prepare("INSERT INTO tenants (name,slug,status,plan_code) VALUES ('ISP Paket Dua','isp-paket-dua','trial','starter')").run().lastInsertRowid;
const user2=db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES ('Admin Tenant Dua','admin-tenant-dua@example.test',?,'admin')")
 .run(bcrypt.hashSync("tenant-two-user-password",4)).lastInsertRowid;
db.prepare("DELETE FROM tenant_memberships WHERE tenant_id=1 AND user_id=?").run(user2);
db.prepare("INSERT INTO tenant_memberships (tenant_id,user_id,role,status) VALUES (?,?,'admin','active')").run(tenant2,user2);
const plan2=db.prepare("INSERT INTO internet_plans (tenant_id,plan_code,name,speed_mbps,monthly_price_idr) VALUES (?, 'PLAN-SECRET-T2','Paket Rahasia Tenant Dua',25,175000)").run(tenant2).lastInsertRowid;
const voucher2=db.prepare("INSERT INTO voucher_packages (tenant_id,package_code,name,validity_value,validity_unit,price_idr) VALUES (?, 'VOUCHER-SECRET-T2','Voucher Rahasia Dua',1,'days',5000)").run(tenant2).lastInsertRowid;

const server=http.createServer(app);
let baseUrl;
test.before(async()=>{await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));baseUrl="http://127.0.0.1:"+server.address().port;});
test.after(async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();fs.rmSync(tempDir,{recursive:true,force:true});});

function tokenFrom(html){const m=html.match(/name="_csrf"\s+value="([^"]+)"/);assert.ok(m);return m[1];}
function cookieFrom(response,current=""){const value=response.headers.get("set-cookie");return value?value.split(";")[0]:current;}
async function get(pathname,session){const r=await fetch(baseUrl+pathname,{headers:{cookie:session.cookie||""},redirect:"manual"});session.cookie=cookieFrom(r,session.cookie||"");return r;}
async function post(pathname,session,values={}){const r=await fetch(baseUrl+pathname,{method:"POST",redirect:"manual",headers:{"content-type":"application/x-www-form-urlencoded","x-csrf-token":session.token,cookie:session.cookie},body:new URLSearchParams({...values,_csrf:session.token})});session.cookie=cookieFrom(r,session.cookie);return r;}
async function login(){const session={cookie:""};const page=await get("/login",session);assert.equal(page.status,200);session.token=tokenFrom(await page.text());const r=await post("/login",session,{identifier:"tenant-one-plan-admin@example.test",password:"tenant-user-plan-password"});assert.equal(r.status,302);return session;}
async function refreshToken(pathname,session){const page=await get(pathname,session);assert.equal(page.status,200);const html=await page.text();session.token=tokenFrom(html);return html;}

test("user and package administration hides other tenant records",async()=>{
 const session=await login();
 const users=await refreshToken("/admin/users",session);
 assert.doesNotMatch(users,/admin-tenant-dua@example\.test|Admin Tenant Dua/);
 const plans=await refreshToken("/plans",session);
 assert.doesNotMatch(plans,/PLAN-SECRET-T2|Paket Rahasia Tenant Dua|VOUCHER-SECRET-T2|Voucher Rahasia Dua/);
});

test("tenant one cannot modify another tenant user, monthly plan or voucher package",async()=>{
 const session=await login();
 await refreshToken("/admin/users",session);
 const userStatus=await post("/admin/users/"+user2+"/status",session);
 assert.equal(userStatus.status,404);
 await refreshToken("/plans",session);
 const planStatus=await post("/plans/monthly/"+plan2+"/status",session);
 assert.equal(planStatus.status,404);
 await refreshToken("/plans?type=voucher",session);
 const voucherStatus=await post("/plans/voucher/"+voucher2+"/status",session);
 assert.equal(voucherStatus.status,404);
 assert.equal(db.prepare("SELECT is_active FROM internet_plans WHERE id=? AND tenant_id=?").get(plan2,tenant2).is_active,1);
 assert.equal(db.prepare("SELECT is_active FROM voucher_packages WHERE id=? AND tenant_id=?").get(voucher2,tenant2).is_active,1);
});

test("newly created staff accounts receive only the default tenant membership",async()=>{
 const session=await login();
 await refreshToken("/admin/users",session);
 const response=await post("/admin/users",session,{name:"Teknisi Baru",email:"teknisi-baru@example.test",password:"password-baru-aman-123",role:"teknisi"});
 assert.equal(response.status,302);
 const user=db.prepare("SELECT id FROM users WHERE email='teknisi-baru@example.test'").get();
 assert.ok(user);
 assert.equal(db.prepare("SELECT COUNT(*) AS total FROM tenant_memberships WHERE user_id=? AND tenant_id=1 AND status='active'").get(user.id).total,1);
 assert.equal(db.prepare("SELECT COUNT(*) AS total FROM tenant_memberships WHERE user_id=? AND tenant_id<>1").get(user.id).total,0);
});
