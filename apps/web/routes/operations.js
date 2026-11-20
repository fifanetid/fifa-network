"use strict";
const router=require("express").Router();
const {db}=require("../../../database/db");
const {recordAudit}=require("../../../modules/audit");
const {requireRole}=require("../middleware/auth");
const managers=requireRole("admin","finance"), admins=requireRole("admin");
const idr=v=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(v);
function page(req,res,extra={}) {
 const tenantId=req.tenant.id;
 const tab=["odp","expenses","inventory"].includes(req.query.tab)?req.query.tab:"odp";
 res.render("operations/index",{title:"Operasional ISP",tab,
  odps:db.prepare("SELECT o.*,(SELECT COUNT(*) FROM customers c WHERE c.odp_id=o.id AND c.tenant_id=o.tenant_id) customer_count FROM network_odps o WHERE o.tenant_id=? ORDER BY o.odp_code").all(tenantId),
  expenses:db.prepare("SELECT e.*,c.name category_name FROM expenses e LEFT JOIN expense_categories c ON c.id=e.category_id AND c.tenant_id=e.tenant_id WHERE e.tenant_id=? ORDER BY e.expense_date DESC,e.id DESC LIMIT 100").all(tenantId),
  categories:db.prepare("SELECT * FROM expense_categories WHERE tenant_id=? ORDER BY name").all(tenantId),
  items:db.prepare("SELECT * FROM inventory_items WHERE tenant_id=? AND is_active=1 ORDER BY name").all(tenantId),
  movements:db.prepare("SELECT m.*,i.sku,i.name item_name FROM inventory_movements m JOIN inventory_items i ON i.id=m.item_id AND i.tenant_id=m.tenant_id WHERE m.tenant_id=? ORDER BY m.id DESC LIMIT 60").all(tenantId),
  summary:{expense:db.prepare("SELECT COALESCE(SUM(amount_idr),0) total FROM expenses WHERE tenant_id=? AND strftime('%Y-%m',expense_date)=strftime('%Y-%m','now')").get(tenantId).total,
   stock:db.prepare("SELECT COUNT(*) total FROM inventory_items WHERE tenant_id=? AND is_active=1 AND quantity<=min_quantity").get(tenantId).total,
   odps:db.prepare("SELECT COUNT(*) total FROM network_odps WHERE tenant_id=?").get(tenantId).total},
  notice:null,error:null,...extra});
}
router.get("/",managers,(req,res)=>page(req,res,{notice:req.query.notice||null,error:req.query.error||null}));
router.post("/odp",admins,(req,res)=>{
 try{
  const code=String(req.body.odp_code||"").trim().toUpperCase(),name=String(req.body.name||"").trim(),address=String(req.body.address||"").trim();
  const lat=req.body.latitude===""?null:Number(req.body.latitude),lng=req.body.longitude===""?null:Number(req.body.longitude),capacity=Number(req.body.port_capacity||8);
  if(code.length<2||code.length>40||name.length<2||name.length>100)throw Error("Kode ODP/nama tidak valid.");
  if((lat!==null&&!Number.isFinite(lat))||(lng!==null&&!Number.isFinite(lng))||(lat===null)!==(lng===null)||lat!==null&&(lat < -90||lat>90||lng < -180||lng>180))throw Error("Koordinat harus berupa pasangan latitude/longitude yang valid.");
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>256)throw Error("Kapasitas port harus 1–256.");
  const r=db.prepare("INSERT INTO network_odps(tenant_id,odp_code,name,address,latitude,longitude,port_capacity) VALUES(?,?,?,?,?,?,?)").run(req.tenant.id,code,name,address||null,lat,lng,capacity);
  recordAudit({user:req.session.user,action:"network.odp.create",entityType:"network_odp",entityId:r.lastInsertRowid,summary:"Menambahkan ODP "+code,tenantId:req.tenant.id});
  res.redirect("/admin/operations?tab=odp&notice="+encodeURIComponent("ODP berhasil ditambahkan."));
 }catch(e){res.redirect("/admin/operations?tab=odp&error="+encodeURIComponent(e.code==="SQLITE_CONSTRAINT_UNIQUE"?"Kode ODP sudah digunakan.":e.message));}
});
router.post("/expense-category",admins,(req,res)=>{
 try{const name=String(req.body.name||"").trim();if(name.length<2||name.length>60)throw Error("Nama kategori 2–60 karakter.");db.prepare("INSERT INTO expense_categories(tenant_id,name) VALUES(?,?)").run(req.tenant.id,name);res.redirect("/admin/operations?tab=expenses&notice=Kategori%20ditambahkan");}
 catch(e){res.redirect("/admin/operations?tab=expenses&error="+encodeURIComponent(e.message));}
});
router.post("/expenses",managers,(req,res)=>{
 try{
  const desc=String(req.body.description||"").trim(),amount=Number(req.body.amount_idr),date=String(req.body.expense_date||""),method=String(req.body.payment_method||"cash"),cat=req.body.category_id?Number(req.body.category_id):null;
  if(desc.length<3||desc.length>240||!Number.isSafeInteger(amount)||amount<1||!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)||!["cash","bank_transfer","qris","other"].includes(method))throw Error("Data pengeluaran tidak valid.");
  const d=new Date(date+"T00:00:00Z");if(d.toISOString().slice(0,10)!==date)throw Error("Tanggal tidak valid.");
  if(cat!==null&&!db.prepare("SELECT id FROM expense_categories WHERE id=? AND tenant_id=?").get(cat,req.tenant.id))throw Error("Kategori tidak ditemukan.");
  const number="EXP-"+Date.now().toString(36).toUpperCase();
  const r=db.prepare("INSERT INTO expenses(tenant_id,expense_number,category_id,description,amount_idr,expense_date,payment_method,vendor,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)").run(req.tenant.id,number,cat,desc,amount,date,method,String(req.body.vendor||"").trim().slice(0,120)||null,String(req.body.notes||"").trim().slice(0,500)||null,req.session.user.id);
  recordAudit({user:req.session.user,action:"finance.expense.create",entityType:"expense",entityId:r.lastInsertRowid,summary:"Mencatat pengeluaran "+number+" sebesar "+idr(amount),tenantId:req.tenant.id});
  res.redirect("/admin/operations?tab=expenses&notice=Pengeluaran%20tersimpan");
 }catch(e){res.redirect("/admin/operations?tab=expenses&error="+encodeURIComponent(e.message));}
});
router.post("/inventory",admins,(req,res)=>{
 try{
  const sku=String(req.body.sku||"").trim().toUpperCase(),name=String(req.body.name||"").trim(),category=String(req.body.category||"").trim(),unit=String(req.body.unit||"pcs").trim(),cost=Number(req.body.unit_cost_idr||0),min=Number(req.body.min_quantity||0);
  if(sku.length<2||sku.length>40||name.length<2||name.length>120||category.length<2||category.length>60||!Number.isSafeInteger(cost)||cost<0||!Number.isSafeInteger(min)||min<0)throw Error("Data barang tidak valid.");
  const r=db.prepare("INSERT INTO inventory_items(tenant_id,sku,name,category,unit,unit_cost_idr,min_quantity,location,notes) VALUES(?,?,?,?,?,?,?,?,?)").run(req.tenant.id,sku,name,category,unit,cost,min,String(req.body.location||"").trim().slice(0,100)||null,String(req.body.notes||"").trim().slice(0,500)||null);
  recordAudit({user:req.session.user,action:"inventory.item.create",entityType:"inventory_item",entityId:r.lastInsertRowid,summary:"Menambahkan barang "+sku,tenantId:req.tenant.id});
  res.redirect("/admin/operations?tab=inventory&notice=Barang%20ditambahkan");
 }catch(e){res.redirect("/admin/operations?tab=inventory&error="+encodeURIComponent(e.code==="SQLITE_CONSTRAINT_UNIQUE"?"SKU sudah digunakan.":e.message));}
});
router.post("/inventory/:id/movement",admins,(req,res)=>{
 try{
  const id=Number(req.params.id),type=String(req.body.movement_type||""),qty=Number(req.body.quantity);
  if(!Number.isSafeInteger(id)||id<1||!["in","out","adjustment"].includes(type)||!Number.isSafeInteger(qty)||qty<1)throw Error("Mutasi stok tidak valid.");
  const r=db.prepare("INSERT INTO inventory_movements(tenant_id,item_id,movement_type,quantity,reference,notes,created_by) VALUES(?,?,?,?,?,?,?)").run(req.tenant.id,id,type,qty,String(req.body.reference||"").trim().slice(0,100)||null,String(req.body.notes||"").trim().slice(0,300)||null,req.session.user.id);
  recordAudit({user:req.session.user,action:"inventory.stock."+type,entityType:"inventory_movement",entityId:r.lastInsertRowid,summary:"Mutasi stok item #"+id+" jenis "+type+" jumlah "+qty,tenantId:req.tenant.id});
  res.redirect("/admin/operations?tab=inventory&notice=Mutasi%20stok%20tersimpan");
 }catch(e){res.redirect("/admin/operations?tab=inventory&error="+encodeURIComponent(e.message));}
});
module.exports=router;
