"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const bcrypt=require("bcryptjs");

const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"ff-tenant-genieacs-config-"));
process.env.BILLING_DB_PATH=path.join(tempDir,"genieacs.sqlite");
process.env.SESSION_SECRET="tenant-genieacs-test-secret-long-enough-123456";
process.env.APP_ENCRYPTION_KEY="c".repeat(64);
const {db}=require("../../database/db");
const app=require("../../apps/web/app");
const {decryptSecret}=require("../../modules/security/secrets");
const {getGenieAcsClient,genieAcsConfigurationStatus}=require("../../modules/genieacs");

db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES ('GenieACS Admin','genieacs-admin@example.test',?,'admin')")
 .run(bcrypt.hashSync("genieacs-admin-password",4));

const server=http.createServer(app);
let baseUrl;
test.before(async()=>{await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));baseUrl="http://127.0.0.1:"+server.address().port;});
test.after(async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();fs.rmSync(tempDir,{recursive:true,force:true});});

function tokenFrom(html){const m=html.match(/name="_csrf"\s+value="([^"]+)"/);assert.ok(m);return m[1];}
function cookieFrom(response,current=""){const value=response.headers.get("set-cookie");return value?value.split(";")[0]:current;}
async function get(pathname,session){const r=await fetch(baseUrl+pathname,{headers:{cookie:session.cookie||""},redirect:"manual"});session.cookie=cookieFrom(r,session.cookie||"");return r;}
async function post(pathname,session,values={}){const r=await fetch(baseUrl+pathname,{method:"POST",redirect:"manual",headers:{"content-type":"application/x-www-form-urlencoded","x-csrf-token":session.token,cookie:session.cookie},body:new URLSearchParams({...values,_csrf:session.token})});session.cookie=cookieFrom(r,session.cookie);return r;}
async function login(){const session={cookie:""};const page=await get("/login",session);assert.equal(page.status,200);session.token=tokenFrom(await page.text());const r=await post("/login",session,{identifier:"genieacs-admin@example.test",password:"genieacs-admin-password"});assert.equal(r.status,302);return session;}
async function refreshToken(pathname,session){const page=await get(pathname,session);assert.equal(page.status,200);const html=await page.text();session.token=tokenFrom(html);return html;}

test("GenieACS integration saves encrypted tenant credentials without rendering the secret",async()=>{
 const session=await login();
 await refreshToken("/admin/genieacs",session);
 const secret="super-secret-nbi-password";
 const saved=await post("/admin/genieacs/settings",session,{
  endpoint_url:"http://192.168.1.10:7557",username:"tenant-nbi-user",password:secret,is_enabled:"1"
 });
 assert.equal(saved.status,302);
 const row=db.prepare("SELECT * FROM tenant_integrations WHERE tenant_id=1 AND integration_type='genieacs' AND display_name='primary'").get();
 assert.ok(row);
 assert.notEqual(row.secret_encrypted,secret);
 assert.match(row.secret_encrypted,/^v1:/);
 assert.equal(decryptSecret(row.secret_encrypted),secret);
 const html=await refreshToken("/admin/genieacs",session);
 assert.match(html,/http:\/\/192\.168\.1\.10:7557/);
 assert.match(html,/tenant-nbi-user/);
 assert.doesNotMatch(html,/super-secret-nbi-password/);
});

test("blank password preserves the encrypted secret and public HTTP endpoints are rejected",async()=>{
 const session=await login();
 await refreshToken("/admin/genieacs",session);
 const before=db.prepare("SELECT secret_encrypted FROM tenant_integrations WHERE tenant_id=1 AND integration_type='genieacs' AND display_name='primary'").get();
 const saved=await post("/admin/genieacs/settings",session,{
  endpoint_url:"http://192.168.1.10:7557",username:"tenant-nbi-user",password:"",is_enabled:"1"
 });
 assert.equal(saved.status,302);
 const after=db.prepare("SELECT secret_encrypted FROM tenant_integrations WHERE tenant_id=1 AND integration_type='genieacs' AND display_name='primary'").get();
 assert.equal(after.secret_encrypted,before.secret_encrypted);
 const html=await refreshToken("/admin/genieacs",session);
 const invalid=await post("/admin/genieacs/settings",session,{
  endpoint_url:"http://example.com:7557",username:"tenant-nbi-user",password:"",is_enabled:"1"
 });
 assert.equal(invalid.status,200);
 const invalidHtml=await invalid.text();
 assert.match(invalidHtml,/host privat|HTTPS/);
 assert.equal(db.prepare("SELECT endpoint_url FROM tenant_integrations WHERE tenant_id=1 AND integration_type='genieacs' AND display_name='primary'").get().endpoint_url,"http://192.168.1.10:7557");
});

test("tenant GenieACS client uses the encrypted tenant credential for NBI Basic Auth",async()=>{
 let captured;
 const client=getGenieAcsClient(1,{fetch:async(url,options)=>{
  captured={url:String(url),options};
  return {ok:true,status:200,headers:{get:()=>null},text:async()=>"[]"};
 }});
 const result=await client.health();
 assert.equal(result.ok,true);
 assert.equal(captured.options.headers.Authorization,"Basic "+Buffer.from("tenant-nbi-user:super-secret-nbi-password").toString("base64"));
 const status=genieAcsConfigurationStatus(1);
 assert.equal(status.configured,true);
 assert.equal(status.enabled,true);
 assert.equal(status.authenticationConfigured,true);
 assert.equal("password" in status,false);
});
