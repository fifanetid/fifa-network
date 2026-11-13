const router = require("express").Router();
const { db } = require("../../../database/db");
const billing = require("../../../modules/billing");
const { recordAudit } = require("../../../modules/audit");
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
    invoices: db.prepare("SELECT i.*,c.full_name,c.customer_code,COALESCE((SELECT SUM(amount_idr) FROM payments WHERE invoice_id=i.id),0) - COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r JOIN payments p ON p.id=r.payment_id WHERE p.invoice_id=i.id),0) AS paid_idr FROM invoices i JOIN customers c ON c.id=i.customer_id ORDER BY i.id DESC").all(),
    payments: db.prepare("SELECT p.*,i.invoice_number,COALESCE((SELECT SUM(amount_idr) FROM payment_reversals WHERE payment_id=p.id),0) AS reversed_idr FROM payments p JOIN invoices i ON i.id=p.invoice_id ORDER BY p.id DESC LIMIT 100").all(),
    reversals: db.prepare("SELECT r.*,p.payment_reference,i.invoice_number FROM payment_reversals r JOIN payments p ON p.id=r.payment_id JOIN invoices i ON i.id=p.invoice_id ORDER BY r.id DESC LIMIT 100").all(),
    dueReminders: billing.getDueReminders({ today: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()), daysAhead: 7 }),
    ...extra
  };
}
router.get("/", managers, (req,res) => res.render("billing/index", pageData({ notice: req.query.notice || null })));

router.post("/customers", managers, (req,res) => {
  try {
    const v=billing.validateCustomer(req.body);
    const result = db.prepare("INSERT INTO customers (customer_code,full_name,email,phone,address,identity_number,notes) VALUES (?,?,?,?,?,?,?)").run(v.customer_code,v.full_name,v.email,v.phone,v.address,v.identity_number,v.notes);
    recordAudit({ user: req.session.user, action: "customer.create", entityType: "customer", entityId: result.lastInsertRowid, summary: "Menambahkan pelanggan " + v.customer_code });
    res.redirect("/billing?notice=Pelanggan%20berhasil%20ditambahkan.");
  } catch(e) { if(e.code==="SQLITE_CONSTRAINT_UNIQUE") return fail(res,new Error("Kode pelanggan sudah digunakan.")); return fail(res,e); }
});
router.post("/customers/:id/update", managers, (req,res) => {
  const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<1) return res.status(400).send("ID tidak valid.");
  try { const v=billing.validateCustomer(req.body); const r=db.prepare("UPDATE customers SET customer_code=?,full_name=?,email=?,phone=?,address=?,identity_number=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(v.customer_code,v.full_name,v.email,v.phone,v.address,v.identity_number,v.notes,id); if(!r.changes)return res.status(404).send("Pelanggan tidak ditemukan."); recordAudit({ user: req.session.user, action: "customer.update", entityType: "customer", entityId: id, summary: "Memperbarui data pelanggan " + v.customer_code }); res.redirect("/billing?notice=Data%20pelanggan%20diperbarui."); }
  catch(e){ if(e.code==="SQLITE_CONSTRAINT_UNIQUE")return fail(res,new Error("Kode pelanggan sudah digunakan.")); return fail(res,e); }
});
router.post("/customers/:id/status", managers, (req,res) => {
  const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID tidak valid.");
  const r=db.prepare("UPDATE customers SET status=CASE status WHEN 'active' THEN 'inactive' ELSE 'active' END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  if(!r.changes)return res.status(404).send("Pelanggan tidak ditemukan."); recordAudit({ user: req.session.user, action: "customer.status", entityType: "customer", entityId: id, summary: "Mengubah status pelanggan ID " + id }); res.redirect("/billing?notice=Status%20pelanggan%20diperbarui.");
});
router.post("/plans", admins, (req,res) => {
  try {const v=billing.validatePlan(req.body);const result=db.prepare("INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr,description) VALUES (?,?,?,?,?)").run(v.plan_code,v.name,v.speed_mbps,v.monthly_price_idr,v.description);recordAudit({ user: req.session.user, action: "plan.create", entityType: "internet_plan", entityId: result.lastInsertRowid, summary: "Menambahkan paket " + v.plan_code });res.redirect("/billing?notice=Paket%20berhasil%20ditambahkan.");}
  catch(e){if(e.code==="SQLITE_CONSTRAINT_UNIQUE")return fail(res,new Error("Kode paket sudah digunakan."));return fail(res,e);}
});
router.post("/plans/:id/update", admins, (req,res) => {
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID tidak valid.");
  try{const v=billing.validatePlan(req.body);const r=db.prepare("UPDATE internet_plans SET plan_code=?,name=?,speed_mbps=?,monthly_price_idr=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(v.plan_code,v.name,v.speed_mbps,v.monthly_price_idr,v.description,id);if(!r.changes)return res.status(404).send("Paket tidak ditemukan.");recordAudit({ user: req.session.user, action: "plan.update", entityType: "internet_plan", entityId: id, summary: "Memperbarui paket " + v.plan_code });res.redirect("/billing?notice=Paket%20diperbarui.");}catch(e){if(e.code==="SQLITE_CONSTRAINT_UNIQUE")return fail(res,new Error("Kode paket sudah digunakan."));return fail(res,e);}
});
router.post("/plans/:id/status", admins, (req,res) => {const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID tidak valid.");const r=db.prepare("UPDATE internet_plans SET is_active=1-is_active,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);if(!r.changes)return res.status(404).send("Paket tidak ditemukan.");recordAudit({ user: req.session.user, action: "plan.status", entityType: "internet_plan", entityId: id, summary: "Mengubah status paket ID " + id });res.redirect("/billing?notice=Status%20paket%20diperbarui.");});

router.post("/subscriptions", managers, (req,res) => {
  try {
    const customerId=Number(req.body.customer_id),planId=Number(req.body.plan_id),billingDay=Number(req.body.billing_day||1);
    const start=billing.validateDate(req.body.start_date,"Tanggal mulai");
    if(!Number.isSafeInteger(customerId)||customerId<1||!Number.isSafeInteger(planId)||planId<1||!Number.isInteger(billingDay)||billingDay<1||billingDay>28)throw new Error("Data langganan tidak valid.");
    if(!db.prepare("SELECT id FROM customers WHERE id=? AND status='active'").get(customerId))throw new Error("Pelanggan tidak aktif/tidak ditemukan.");
    if(!db.prepare("SELECT id FROM internet_plans WHERE id=? AND is_active=1").get(planId))throw new Error("Paket tidak aktif/tidak ditemukan.");
    const externalRef=billing.optionalText(req.body.external_device_ref,"Referensi perangkat",150);
    const notes=billing.optionalText(req.body.notes,"Catatan langganan");
    const result=db.prepare("INSERT INTO subscriptions (customer_id,plan_id,start_date,billing_day,external_device_ref,notes) VALUES (?,?,?,?,?,?)").run(customerId,planId,start,billingDay,externalRef,notes);
    recordAudit({ user: req.session.user, action: "subscription.create", entityType: "subscription", entityId: result.lastInsertRowid, summary: "Membuat langganan untuk pelanggan ID " + customerId });
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
    db.prepare("UPDATE subscriptions SET status=?,end_date=CASE WHEN ?='terminated' THEN CASE WHEN date('now') < start_date THEN start_date ELSE date('now') END ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,status,id);
    recordAudit({ user: req.session.user, action: "subscription.status", entityType: "subscription", entityId: id, summary: "Mengubah status langganan ID " + id + " menjadi " + status });
    res.redirect("/billing?notice=Status%20langganan%20diperbarui.");
  } catch(e) { return fail(res,e); }
});
router.post("/invoices/generate-monthly", managers, (req,res) => {
  try {
    const invoices = billing.generateMonthlyInvoices({
      period: req.body.billing_period,
      dueDate: req.body.due_date
    });
    recordAudit({
      user: req.session.user,
      action: "invoice.batch_create",
      entityType: "invoice_batch",
      entityId: invoices[0]?.id || null,
      summary: "Menerbitkan " + invoices.length + " invoice otomatis untuk periode " + req.body.billing_period
    });
    res.redirect("/billing?notice=" + encodeURIComponent(
      invoices.length + " invoice berhasil dibuat. Invoice yang sudah ada dilewati."
    ));
  } catch(e) { return fail(res,e); }
});
router.post("/invoices", managers, (req,res) => {
  try{const invoice=billing.createInvoice({subscriptionId:req.body.subscription_id,period:req.body.billing_period,dueDate:req.body.due_date,discount:req.body.discount_idr||0,notes:req.body.notes||""});recordAudit({ user: req.session.user, action: "invoice.create", entityType: "invoice", entityId: invoice.id, summary: "Membuat invoice " + invoice.invoice_number });res.redirect("/billing?notice=Invoice%20berhasil%20dibuat.");}
  catch(e){if(String(e.message).includes("UNIQUE"))return fail(res,new Error("Invoice untuk langganan dan periode ini sudah ada."));return fail(res,e);}
});
router.post("/invoices/:id/payments", managers, (req,res) => {
  try{const payment=billing.recordPayment({invoiceId:req.params.id,input:req.body,userId:req.session.user.id});recordAudit({ user: req.session.user, action: "payment.create", entityType: "payment", entityId: payment.id, summary: "Mencatat pembayaran " + payment.payment_reference + " sebesar Rp" + payment.amount_idr });res.redirect("/billing?notice=Pembayaran%20berhasil%20dicatat.");}
  catch(e){return fail(res,e);}
});
router.post("/payments/:id/reversals", admins, (req,res) => {
  try {
    const reversal = billing.recordPaymentReversal({ paymentId: req.params.id, input: req.body, userId: req.session.user.id });
    recordAudit({ user: req.session.user, action: "payment.reverse", entityType: "payment_reversal", entityId: reversal.id, summary: "Membalik pembayaran " + reversal.reversal_reference + " sebesar Rp" + reversal.amount_idr });
    res.redirect("/billing?notice=Pembalikan%20pembayaran%20" + encodeURIComponent(reversal.reversal_reference) + "%20berhasil%20dicatat.");
  } catch(e) { return fail(res,e); }
});
router.post("/invoices/:id/void", admins, (req,res) => {
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID tidak valid.");
  const invoice=db.prepare("SELECT status FROM invoices WHERE id=?").get(id);if(!invoice)return res.status(404).send("Invoice tidak ditemukan.");
  const paymentCount=db.prepare("SELECT COUNT(*) AS total FROM payments WHERE invoice_id=?").get(id).total;
  if(paymentCount>0)return res.status(409).send("Invoice yang memiliki riwayat pembayaran tidak dapat dibatalkan, termasuk setelah reversal.");
  db.prepare("UPDATE invoices SET status='void' WHERE id=?").run(id);recordAudit({ user: req.session.user, action: "invoice.void", entityType: "invoice", entityId: id, summary: "Membatalkan invoice ID " + id });res.redirect("/billing?notice=Invoice%20dibatalkan.");
});
module.exports=router;
