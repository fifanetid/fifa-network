"use strict";
const router = require("express").Router();
const { db } = require("../../../database/db");
const { getGenieAcsClient, genieAcsConfigurationStatus } = require("../../../modules/genieacs");
const { getConfig } = require("../../../modules/genieacs/client");
const { encryptSecret } = require("../../../modules/security/secrets");
const { recordAudit } = require("../../../modules/audit");
const { requireRole } = require("../middleware/auth");
const canView = requireRole("admin", "teknisi");
const admins = requireRole("admin");

function loadLinks(tenantId) {
 return db.prepare("SELECT l.*,c.customer_code,c.full_name,s.id AS linked_subscription_id,p.name AS plan_name FROM genieacs_device_links l JOIN customers c ON c.id=l.customer_id AND c.tenant_id=l.tenant_id LEFT JOIN subscriptions s ON s.id=l.subscription_id AND s.tenant_id=l.tenant_id LEFT JOIN internet_plans p ON p.id=s.plan_id AND p.tenant_id=l.tenant_id WHERE l.tenant_id=? ORDER BY l.linked_at DESC,l.id DESC LIMIT 200").all(tenantId);
}
async function renderPage(req,res,extra={}) {
 const configuration=genieAcsConfigurationStatus(req.tenant.id);
 const search=String(extra.search ?? req.query.search ?? "").trim().slice(0,100);
 let devices=[],connectionError=null;
 if(search&&configuration.configured&&configuration.enabled){try{devices=await getGenieAcsClient(req.tenant.id).listDevices({search,limit:100});}catch(e){connectionError=e.message;}}
 return res.render("genieacs/index",{
  title:"GenieACS / ONT",configuration,search,devices,links:loadLinks(req.tenant.id),
  customers:db.prepare("SELECT id,customer_code,full_name FROM customers WHERE tenant_id=? AND status='active' ORDER BY full_name COLLATE NOCASE").all(req.tenant.id),
  subscriptions:db.prepare("SELECT s.id,s.customer_id,p.name AS plan_name,s.status FROM subscriptions s JOIN internet_plans p ON p.id=s.plan_id AND p.tenant_id=s.tenant_id WHERE s.tenant_id=? AND s.status IN ('active','suspended') ORDER BY s.id DESC").all(req.tenant.id),
  notice:null,...extra,error:extra.error || connectionError
 });
}
router.get("/",canView,async(req,res)=>renderPage(req,res,{notice:req.query.notice||null,error:req.query.error||null}));

router.post("/settings",admins,(req,res)=>{
 try {
  const endpointUrl=String(req.body.endpoint_url||"").trim();
  const username=String(req.body.username||"").trim();
  const password=String(req.body.password||"");
  const enabled=req.body.is_enabled==="1";
  if(username.length>200||password.length>20000) throw new Error("Username atau password NBI terlalu panjang.");
  const validated=getConfig({GENIEACS_NBI_URL:endpointUrl,GENIEACS_USERNAME:username,GENIEACS_PASSWORD:password,GENIEACS_NBI_TIMEOUT_MS:"8000"});
  const existing=db.prepare("SELECT secret_encrypted FROM tenant_integrations WHERE tenant_id=? AND integration_type='genieacs' AND display_name='primary'").get(req.tenant.id);
  const encrypted=password?encryptSecret(password):(existing?.secret_encrypted||null);
  db.prepare(`
   INSERT INTO tenant_integrations
    (tenant_id,integration_type,display_name,endpoint_url,username,secret_encrypted,config_json,is_enabled,last_tested_at,last_test_status)
   VALUES (?,'genieacs','primary',?,?,?,?,?,NULL,NULL)
   ON CONFLICT(tenant_id,integration_type,display_name) DO UPDATE SET
    endpoint_url=excluded.endpoint_url,username=excluded.username,
    secret_encrypted=excluded.secret_encrypted,config_json=excluded.config_json,
    is_enabled=excluded.is_enabled,last_tested_at=NULL,last_test_status=NULL,updated_at=CURRENT_TIMESTAMP
  `).run(req.tenant.id,validated.baseUrl,username,encrypted,JSON.stringify({timeoutMs:validated.timeoutMs}),enabled?1:0);
  recordAudit({user:req.session.user,action:"genieacs.integration.update",entityType:"tenant_integration",summary:"Memperbarui konfigurasi koneksi GenieACS untuk tenant",tenantId:req.tenant.id});
  return res.redirect("/admin/genieacs?notice="+encodeURIComponent("Konfigurasi GenieACS berhasil disimpan. Password tersimpan terenkripsi."));
 } catch(error) {
  return renderPage(req,res,{error:error.message});
 }
});
router.post("/settings/test",admins,async(req,res)=>{
 try {
  const result=await getGenieAcsClient(req.tenant.id).health();
  db.prepare("UPDATE tenant_integrations SET last_tested_at=CURRENT_TIMESTAMP,last_test_status='success' WHERE tenant_id=? AND integration_type='genieacs' AND display_name='primary'").run(req.tenant.id);
  recordAudit({user:req.session.user,action:"genieacs.integration.test",entityType:"tenant_integration",summary:"Uji koneksi GenieACS berhasil",tenantId:req.tenant.id});
  return renderPage(req,res,{notice:"Koneksi GenieACS berhasil diuji.",health:result});
 } catch(error) {
  db.prepare("UPDATE tenant_integrations SET last_tested_at=CURRENT_TIMESTAMP,last_test_status='failed' WHERE tenant_id=? AND integration_type='genieacs' AND display_name='primary'").run(req.tenant.id);
  recordAudit({user:req.session.user,action:"genieacs.integration.test_failed",entityType:"tenant_integration",summary:"Uji koneksi GenieACS gagal: "+String(error.message).slice(0,200),tenantId:req.tenant.id});
  return renderPage(req,res,{error:error.message});
 }
});

router.post("/links",admins,async(req,res)=>{
 const customerId=Number(req.body.customer_id),raw=String(req.body.subscription_id||"").trim(),subscriptionId=raw?Number(raw):null,deviceId=String(req.body.genieacs_device_id||"").trim();
 if(!Number.isSafeInteger(customerId)||customerId<1||(subscriptionId!==null&&(!Number.isSafeInteger(subscriptionId)||subscriptionId<1))) return renderPage(req,res,{error:"Pelanggan atau langganan tidak valid.",search:deviceId});
 try{
  if(!deviceId||deviceId.length>200) throw new Error("ID perangkat GenieACS tidak valid.");
  const customer=db.prepare("SELECT id,customer_code FROM customers WHERE id=? AND tenant_id=? AND status='active'").get(customerId,req.tenant.id);
  if(!customer) throw new Error("Pelanggan aktif tidak ditemukan.");
  if(subscriptionId!==null&&!db.prepare("SELECT id FROM subscriptions WHERE id=? AND customer_id=? AND tenant_id=? AND status IN ('active','suspended')").get(subscriptionId,customerId,req.tenant.id)) throw new Error("Langganan tidak cocok dengan pelanggan yang dipilih.");
  const device=await getGenieAcsClient(req.tenant.id).getDevice(deviceId);
  if(!device) throw new Error("Perangkat tidak ditemukan di GenieACS. Cari berdasarkan ID/serial lalu pilih perangkat yang benar.");
  db.transaction(()=>{
   const result=db.prepare("INSERT INTO genieacs_device_links(tenant_id,customer_id,subscription_id,genieacs_device_id,serial_number,manufacturer,product_class,linked_by) VALUES(?,?,?,?,?,?,?,?)").run(req.tenant.id,customerId,subscriptionId,device.id,device.serialNumber||null,device.manufacturer||null,device.productClass||null,req.session.user.id);
   recordAudit({user:req.session.user,action:"genieacs.device.link",entityType:"genieacs_device_link",entityId:result.lastInsertRowid,summary:"Menautkan perangkat GenieACS "+device.id+" ke pelanggan "+customer.customer_code,tenantId:req.tenant.id});
  })();
  return res.redirect("/admin/genieacs?notice="+encodeURIComponent("Perangkat berhasil ditautkan ke pelanggan."));
 }catch(e){
  const message=e.code==="SQLITE_CONSTRAINT_UNIQUE"?"Perangkat GenieACS ini sudah ditautkan ke pelanggan lain.":e.message;
  return renderPage(req,res,{error:message,search:deviceId});
 }
});
router.post("/links/:id/delete",admins,(req,res)=>{
 const id=Number(req.params.id);
 if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID tautan tidak valid.");
 const link=db.prepare("SELECT id,genieacs_device_id,customer_id FROM genieacs_device_links WHERE id=? AND tenant_id=?").get(id,req.tenant.id);
 if(!link)return res.status(404).send("Tautan perangkat tidak ditemukan.");
 db.transaction(()=>{
  db.prepare("DELETE FROM genieacs_device_links WHERE id=? AND tenant_id=?").run(id,req.tenant.id);
  recordAudit({user:req.session.user,action:"genieacs.device.unlink",entityType:"genieacs_device_link",entityId:id,summary:"Melepas perangkat GenieACS "+link.genieacs_device_id+" dari pelanggan ID "+link.customer_id,tenantId:req.tenant.id});
 })();
 return res.redirect("/admin/genieacs?notice="+encodeURIComponent("Tautan perangkat berhasil dilepas."));
});
module.exports=router;
