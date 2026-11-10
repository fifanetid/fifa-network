const router = require("express").Router();
const { db } = require("../../../database/db");
const billing = require("../../../modules/billing");
const { requireRole } = require("../middleware/auth");
const managers = requireRole("admin", "finance");
const admins = requireRole("admin");
const fail = (res, error) => res.status(400).render("billing/index", pageData({ error: error.message }));

function pageData(extra = {}) {
  return {
    title: "Billing & Pelanggan",
    notice: null,
    error: null,
    customers: db.prepare("SELECT * FROM customers ORDER BY id DESC").all(),
    plans: db.prepare("SELECT * FROM internet_plans ORDER BY id DESC").all(),
    subscriptions: db.prepare("SELECT s.*,c.customer_code,c.full_name,p.name AS plan_name,p.monthly_price_idr FROM subscriptions s JOIN customers c ON c.id=s.customer_id JOIN internet_plans p ON p.id=s.plan_id ORDER BY s.id DESC").all(),
    invoices: db.prepare("SELECT i.*,c.full_name,c.customer_code,COALESCE((SELECT SUM(amount_idr) FROM payments WHERE invoice_id=i.id),0) AS paid_idr FROM invoices i JOIN customers c ON c.id=i.customer_id ORDER BY i.id DESC").all(),
    payments: db.prepare("SELECT p.*,i.invoice_number FROM payments p JOIN invoices i ON i.id=p.invoice_id ORDER BY p.id DESC LIMIT 100").all(),
    ...extra
  };
}
router.get("/", managers, (req,res) => res.render("billing/index", pageData({ notice: req.query.notice || null })));

router.post("/customers", managers, (req,res) => {
  try {
    const v=billing.validateCustomer(req.body);
    db.prepare("INSERT INTO customers (customer_code,full_name,email,phone,address,identity_number,notes) VALUES (?,?,?,?,?,?,?)").run(v.customer_code,v.full_name,v.email,v.phone,v.address,v.identity_number,v.notes);
    res.redirect("/billing?notice=Pelanggan%20berhasil%20ditambahkan.");
  } catch(e) { if(e.code==="SQLITE_CONSTRAINT_UNIQUE") return fail(res,new Error("Kode pelanggan sudah digunakan.")); return fail(res,e); }
});
router.post("/customers/:id/update", managers, (req,res) => {
  const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<1) return res.status(400).send("ID tidak valid.");
  try { const v=billing.validateCustomer(req.body); const r=db.prepare("UPDATE customers SET customer_code=?,full_name=?,email=?,phone=?,address=?,identity_number=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(v.customer_code,v.full_name,v.email,v.phone,v.address,v.identity_number,v.notes,id); if(!r.changes)return res.status(404).send("Pelanggan tidak ditemukan."); res.redirect("/billing?notice=Data%20pelanggan%20diperbarui."); }
  catch(e){ if(e.code==="SQLITE_CONSTRAINT_UNIQUE")return fail(res,new Error("Kode pelanggan sudah digunakan.")); return fail(res,e); }
});
router.post("/customers/:id/status", managers, (req,res) => {
  const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID tidak valid.");
  const r=db.prepare("UPDATE customers SET status=CASE status WHEN 'active' THEN 'inactive' ELSE 'active' END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  if(!r.changes)return res.status(404).send("Pelanggan tidak ditemukan."); res.redirect("/billing?notice=Status%20pelanggan%20diperbarui.");
});
router.post("/plans", admins, (req,res) => {
  try {const v=billing.validatePlan(req.body);db.prepare("INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr,description) VALUES (?,?,?,?,?)").run(v.plan_code,v.name,v.speed_mbps,v.monthly_price_idr,v.description);res.redirect("/billing?notice=Paket%20berhasil%20ditambahkan.");}
  catch(e){if(e.code==="SQLITE_CONSTRAINT_UNIQUE")return fail(res,new Error("Kode paket sudah digunakan."));return fail(res,e);}
});
router.post("/plans/:id/update", admins, (req,res) => {
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID tidak valid.");
  try{const v=billing.validatePlan(req.body);const r=db.prepare("UPDATE internet_plans SET plan_code=?,name=?,speed_mbps=?,monthly_price_idr=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(v.plan_code,v.name,v.speed_mbps,v.monthly_price_idr,v.description,id);if(!r.changes)return res.status(404).send("Paket tidak ditemukan.");res.redirect("/billing?notice=Paket%20diperbarui.");}catch(e){if(e.code==="SQLITE_CONSTRAINT_UNIQUE")return fail(res,new Error("Kode paket sudah digunakan."));return fail(res,e);}
});
router.post("/plans/:id/status", admins, (req,res) => {const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID tidak valid.");const r=db.prepare("UPDATE internet_plans SET is_active=1-is_active,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);if(!r.changes)return res.status(404).send("Paket tidak ditemukan.");res.redirect("/billing?notice=Status%20paket%20diperbarui.");});

router.post("/subscriptions", managers, (req,res) => {
  try {
    const customerId=Number(req.body.customer_id),planId=Number(req.body.plan_id),billingDay=Number(req.body.billing_day||1);
    const start=billing.validateDate(req.body.start_date,"Tanggal mulai");
    if(!Number.isSafeInteger(customerId)||customerId<1||!Number.isSafeInteger(planId)||planId<1||!Number.isInteger(billingDay)||billingDay<1||billingDay>28)throw new Error("Data langganan tidak valid.");
    if(!db.prepare("SELECT id FROM customers WHERE id=? AND status='active'").get(customerId))throw new Error("Pelanggan tidak aktif/tidak ditemukan.");
    if(!db.prepare("SELECT id FROM internet_plans WHERE id=? AND is_active=1").get(planId))throw new Error("Paket tidak aktif/tidak ditemukan.");
    const externalRef=billing.optionalText(req.body.external_device_ref,"Referensi perangkat",150);
    const notes=billing.optionalText(req.body.notes,"Catatan langganan");
    db.prepare("INSERT INTO subscriptions (customer_id,plan_id,start_date,billing_day,external_device_ref,notes) VALUES (?,?,?,?,?,?)").run(customerId,planId,start,billingDay,externalRef,notes);
    res.redirect("/billing?notice=Langganan%20dibuat.");
  }catch(e){return fail(res,e);}
});
router.post("/subscriptions/:id/status", managers, (req,res) => {
  const id=Number(req.params.id),status=String(req.body.status||"");
  if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID tidak valid.");
  try {
    const existing=db.prepare("SELECT status FROM subscriptions WHERE id=?").get(id);
    if(!existing)return res.status(404).send("Langganan tidak ditemukan.");
    billing.validateSubscriptionStatus(existing.status,status);
    db.prepare("UPDATE subscriptions SET status=?,end_date=CASE WHEN ?='terminated' THEN date('now') ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,status,id);
    res.redirect("/billing?notice=Status%20langganan%20diperbarui.");
  } catch(e) { return fail(res,e); }
});
router.post("/invoices", managers, (req,res) => {
  try{billing.createInvoice({subscriptionId:req.body.subscription_id,period:req.body.billing_period,dueDate:req.body.due_date,discount:req.body.discount_idr||0,notes:req.body.notes||""});res.redirect("/billing?notice=Invoice%20berhasil%20dibuat.");}
  catch(e){if(String(e.message).includes("UNIQUE"))return fail(res,new Error("Invoice untuk langganan dan periode ini sudah ada."));return fail(res,e);}
});
router.post("/invoices/:id/payments", managers, (req,res) => {
  try{billing.recordPayment({invoiceId:req.params.id,input:req.body,userId:req.session.user.id});res.redirect("/billing?notice=Pembayaran%20berhasil%20dicatat.");}
  catch(e){return fail(res,e);}
});
router.post("/invoices/:id/void", admins, (req,res) => {
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID tidak valid.");
  const invoice=db.prepare("SELECT status FROM invoices WHERE id=?").get(id);if(!invoice)return res.status(404).send("Invoice tidak ditemukan.");
  const paid=db.prepare("SELECT COALESCE(SUM(amount_idr),0) AS total FROM payments WHERE invoice_id=?").get(id).total;
  if(paid>0)return res.status(409).send("Invoice dengan pembayaran tidak dapat dibatalkan.");
  db.prepare("UPDATE invoices SET status='void' WHERE id=?").run(id);res.redirect("/billing?notice=Invoice%20dibatalkan.");
});
module.exports=router;
