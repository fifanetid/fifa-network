"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const bcrypt=require("bcryptjs");

const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"ff-tenant-auth-gate-"));
process.env.BILLING_DB_PATH=path.join(tempDir,"tenant-auth.sqlite");
process.env.SESSION_SECRET="tenant-auth-gate-test-secret-long-enough-123456";
const {db}=require("../../database/db");
const app=require("../../apps/web/app");

const password="tenant-auth-test-password";
const adminId=db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')")
 .run("Default Tenant Admin","default-tenant-admin@example.test",bcrypt.hashSync(password,4)).lastInsertRowid;
const tenant2=db.prepare("INSERT INTO tenants (name,slug,status,plan_code) VALUES ('ISP Dua','isp-dua-auth','trial','starter')").run().lastInsertRowid;
const tenant2User=db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')")
 .run("Tenant Dua Admin","tenant-dua-admin@example.test",bcrypt.hashSync(password,4)).lastInsertRowid;
db.prepare("DELETE FROM tenant_memberships WHERE user_id=? AND tenant_id=1").run(tenant2User);
db.prepare("INSERT INTO tenant_memberships (tenant_id,user_id,role,status) VALUES (?,?,'admin','active')").run(tenant2,tenant2User);

const server=http.createServer(app);
let baseUrl;
test.before(async()=>{await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));baseUrl="http://127.0.0.1:"+server.address().port;});
test.after(async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();fs.rmSync(tempDir,{recursive:true,force:true});});

function tokenFrom(html){const m=html.match(/name="_csrf"\s+value="([^"]+)"/);assert.ok(m);return m[1];}
function cookieFrom(response,current=""){const value=response.headers.get("set-cookie");return value?value.split(";")[0]:current;}
async function get(pathname,session){const r=await fetch(baseUrl+pathname,{headers:{cookie:session.cookie||""},redirect:"manual"});session.cookie=cookieFrom(r,session.cookie||"");return r;}
async function login(email){const session={cookie:""};const page=await get("/login",session);assert.equal(page.status,200);const token=tokenFrom(await page.text());const response=await fetch(baseUrl+"/login",{method:"POST",redirect:"manual",headers:{"content-type":"application/x-www-form-urlencoded","x-csrf-token":token,cookie:session.cookie},body:new URLSearchParams({identifier:email,password,_csrf:token})});session.cookie=cookieFrom(response,session.cookie);return {session,response};}

test("akun tenant default dapat login dengan membership default",async()=>{
 const result=await login("default-tenant-admin@example.test");
 assert.equal(result.response.status,302);
 const page=await get("/billing",result.session);
 assert.equal(page.status,200);
});

test("akun yang hanya terdaftar pada tenant kedua ditolak sampai isolasi semua modul selesai",async()=>{
 const result=await login("tenant-dua-admin@example.test");
 assert.equal(result.response.status,302);
 assert.equal(result.response.headers.get("location"),"/login?error=1");
 assert.ok(db.prepare("SELECT id FROM tenant_memberships WHERE tenant_id=? AND user_id=?").get(tenant2,tenant2User));
 assert.ok(db.prepare("SELECT id FROM tenant_memberships WHERE tenant_id=1 AND user_id=?").get(adminId));
});
