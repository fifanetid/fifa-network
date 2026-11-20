"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const bcrypt=require("bcryptjs");

const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"ff-tenant-network-scope-"));
process.env.BILLING_DB_PATH=path.join(tempDir,"tenant.sqlite");
process.env.SESSION_SECRET="tenant-network-scope-test-secret-long-enough-123456";
process.env.APP_ENCRYPTION_KEY="b".repeat(64);

const {db}=require("../../database/db");
const app=require("../../apps/web/app");
const {encryptSecret}=require("../../modules/security/secrets");

const adminId=db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')")
 .run("Tenant Scope Admin","tenant-scope-admin@example.test",bcrypt.hashSync("tenant-scope-password",4)).lastInsertRowid;
const tenant2=db.prepare("INSERT INTO tenants (name,slug,status,plan_code) VALUES ('ISP Dua','isp-dua','trial','starter')").run().lastInsertRowid;
const odp2=db.prepare("INSERT INTO network_odps (tenant_id,odp_code,name) VALUES (?, 'ODP-TENANT-2','ODP Rahasia Tenant Dua')").run(tenant2).lastInsertRowid;
const customer2=db.prepare("INSERT INTO customers (tenant_id,customer_code,full_name,phone,address) VALUES (?, 'CUS-TENANT-2','Pelanggan Tenant Dua','081234567890','Alamat Tenant Dua')").run(tenant2).lastInsertRowid;
const router2=db.prepare(`INSERT INTO mikrotik_routers
 (tenant_id,router_name,host,api_port,api_username,api_password_encrypted)
 VALUES (?, 'Router Tenant Dua','192.168.88.22',8728,'tenant2',?)`).run(tenant2,encryptSecret("tenant2-secret-password")).lastInsertRowid;
const link2=db.prepare(`INSERT INTO genieacs_device_links
 (tenant_id,customer_id,genieacs_device_id,serial_number,manufacturer,product_class)
 VALUES (?,?,'device-tenant-2','SN-TENANT-2','Vendor Dua','ONT Dua')`).run(tenant2,customer2).lastInsertRowid;
const item2=db.prepare("INSERT INTO inventory_items (tenant_id,sku,name,category) VALUES (?, 'SKU-TENANT-2','Barang Tenant Dua','Fiber')").run(tenant2).lastInsertRowid;

const server=http.createServer(app);
let baseUrl;
test.before(async()=>{await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));baseUrl="http://127.0.0.1:"+server.address().port;});
test.after(async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();fs.rmSync(tempDir,{recursive:true,force:true});});

function tokenFrom(html){const m=html.match(/name="_csrf"\s+value="([^"]+)"/);assert.ok(m,"CSRF token must be present");return m[1];}
function cookieFrom(response,current=""){const value=response.headers.get("set-cookie");return value?value.split(";")[0]:current;}
async function get(pathname,session,redirect="follow"){const r=await fetch(baseUrl+pathname,{headers:{cookie:session.cookie||""},redirect});session.cookie=cookieFrom(r,session.cookie||"");return r;}
async function post(pathname,session,values={}){const r=await fetch(baseUrl+pathname,{method:"POST",redirect:"manual",headers:{"content-type":"application/x-www-form-urlencoded","x-csrf-token":session.token,cookie:session.cookie},body:new URLSearchParams({...values,_csrf:session.token})});session.cookie=cookieFrom(r,session.cookie);return r;}
async function login(){const session={cookie:""};const page=await get("/login",session);assert.equal(page.status,200);session.token=tokenFrom(await page.text());const r=await post("/login",session,{identifier:"tenant-scope-admin@example.test",password:"tenant-scope-password"});assert.equal(r.status,302);return session;}
async function refreshToken(pathname,session){const page=await get(pathname,session);assert.equal(page.status,200);const html=await page.text();session.token=tokenFrom(html);return html;}

test("network and operations pages only display records from the authenticated tenant",async()=>{
 const session=await login();
 const operations=await refreshToken("/admin/operations?tab=odp",session);
 assert.doesNotMatch(operations,/ODP-TENANT-2|ODP Rahasia Tenant Dua/);
 const mikrotik=await refreshToken("/admin/mikrotik",session);
 assert.doesNotMatch(mikrotik,/Router Tenant Dua|tenant2-secret-password/);
 const genieacs=await refreshToken("/admin/genieacs",session);
 assert.doesNotMatch(genieacs,/SN-TENANT-2|device-tenant-2|Pelanggan Tenant Dua/);
});

test("tenant one cannot delete another tenant router or GenieACS link by guessing IDs",async()=>{
 const session=await login();
 await refreshToken("/admin/mikrotik",session);
 const routerResponse=await post("/admin/mikrotik/routers/"+router2+"/delete",session);
 assert.equal(routerResponse.status,404);
 await refreshToken("/admin/genieacs",session);
 const linkResponse=await post("/admin/genieacs/links/"+link2+"/delete",session);
 assert.equal(linkResponse.status,404);
 assert.ok(db.prepare("SELECT id FROM mikrotik_routers WHERE id=? AND tenant_id=?").get(router2,tenant2));
 assert.ok(db.prepare("SELECT id FROM genieacs_device_links WHERE id=? AND tenant_id=?").get(link2,tenant2));
});

test("tenant one cannot create an inventory movement for tenant two stock",async()=>{
 const session=await login();
 await refreshToken("/admin/operations?tab=inventory",session);
 const response=await post("/admin/operations/inventory/"+item2+"/movement",session,{movement_type:"in",quantity:"5"});
 assert.equal(response.status,302);
 assert.equal(db.prepare("SELECT COUNT(*) AS total FROM inventory_movements WHERE item_id=?").get(item2).total,0);
});

