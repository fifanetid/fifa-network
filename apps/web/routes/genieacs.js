"use strict";
const router = require("express").Router();
const { db } = require("../../../database/db");
const { getGenieAcsClient, genieAcsConfigurationStatus } = require("../../../modules/genieacs");
const { recordAudit } = require("../../../modules/audit");
const { requireRole } = require("../middleware/auth");
const canView = requireRole("admin", "teknisi");
const admins = requireRole("admin");

function loadLinks() {
 return db.prepare("SELECT l.*,c.customer_code,c.full_name,s.id AS linked_subscription_id,p.name AS plan_name FROM genieacs_device_links l JOIN customers c ON c.id=l.customer_id LEFT JOIN subscriptions s ON s.id=l.subscription_id LEFT JOIN internet_plans p ON p.id=s.plan_id ORDER BY l.linked_at DESC,l.id DESC LIMIT 200").all();
}
async function renderPage(req,res,extra={}) {
 const configuration=genieAcsConfigurationStatus();
 const search=String(extra.search ?? req.query.search ?? "").trim().slice(0,100);
 let devices=[],connectionError=null;
 if(search&&configuration.configured){try{devices=await getGenieAcsClient().listDevices({search,limit:100});}catch(e){connectionError=e.message;}}
 return res.render("genieacs/index",{
  title:"GenieACS / ONT",configuration,search,devices,links:loadLinks(),
  customers:db.prepare("SELECT id,customer_code,full_name FROM customers WHERE status='active' ORDER BY full_name COLLATE NOCASE").all(),
  subscriptions:db.prepare("SELECT s.id,s.customer_id,p.name AS plan_name,s.status FROM subscriptions s JOIN internet_plans p ON p.id=s.plan_id WHERE s.status IN ('active','suspended') ORDER BY s.id DESC").all(),
  notice:null,error:connectionError,...extra
 });
}
router.get("/",canView,async(req,res)=>renderPage(req,res,{notice:req.query.notice||null,error:req.query.error||null}));
router.post("/links",admins,async(req,res)=>{
 const customerId=Number(req.body.customer_id),raw=String(req.body.subscription_id||"").trim(),subscriptionId=raw?Number(raw):null,deviceId=String(req.body.genieacs_device_id||"").trim();
 if(!Number.isSafeInteger(customerId)||customerId<1||(subscriptionId!==null&&(!Number.isSafeInteger(subscriptionId)||subscriptionId<1))) return renderPage(req,res,{error:"Pelanggan atau langganan tidak valid.",search:deviceId});
 try{
  if(!deviceId||deviceId.length>200) throw new Error("ID perangkat GenieACS tidak valid.");
  const customer=db.prepare("SELECT id,customer_code FROM customers WHERE id=? AND status='active'").get(customerId);
  if(!customer) throw new Error("Pelanggan aktif tidak ditemukan.");
  if(subscriptionId!==null&&!db.prepare("SELECT id FROM subscriptions WHERE id=? AND customer_id=? AND status IN ('active','suspended')").get(subscriptionId,customerId)) throw new Error("Langganan tidak cocok dengan pelanggan yang dipilih.");
  const device=await getGenieAcsClient().getDevice(deviceId);
  if(!device) throw new Error("Perangkat tidak ditemukan di GenieACS. Cari berdasarkan ID/serial lalu pilih perangkat yang benar.");
  db.transaction(()=>{
   const result=db.prepare("INSERT INTO genieacs_device_links(customer_id,subscription_id,genieacs_device_id,serial_number,manufacturer,product_class,linked_by) VALUES(?,?,?,?,?,?,?)").run(customerId,subscriptionId,device.id,device.serialNumber||null,device.manufacturer||null,device.productClass||null,req.session.user.id);
   recordAudit({user:req.session.user,action:"genieacs.device.link",entityType:"genieacs_device_link",entityId:result.lastInsertRowid,summary:"Menautkan perangkat GenieACS "+device.id+" ke pelanggan "+customer.customer_code});
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
 const link=db.prepare("SELECT id,genieacs_device_id,customer_id FROM genieacs_device_links WHERE id=?").get(id);
 if(!link)return res.status(404).send("Tautan perangkat tidak ditemukan.");
 db.transaction(()=>{
  db.prepare("DELETE FROM genieacs_device_links WHERE id=?").run(id);
  recordAudit({user:req.session.user,action:"genieacs.device.unlink",entityType:"genieacs_device_link",entityId:id,summary:"Melepas perangkat GenieACS "+link.genieacs_device_id+" dari pelanggan ID "+link.customer_id});
 })();
 return res.redirect("/admin/genieacs?notice="+encodeURIComponent("Tautan perangkat berhasil dilepas."));
});
module.exports=router;
