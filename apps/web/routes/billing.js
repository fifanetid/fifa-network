const router = require("express").Router();
const bcrypt = require("bcryptjs");
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
    customers: db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.customer_id=c.id) AS subscription_count,
        (SELECT COUNT(*) FROM invoices i WHERE i.customer_id=c.id) AS invoice_count,
        (SELECT COUNT(*) FROM customer_payment_confirmations pc WHERE pc.customer_id=c.id) AS confirmation_count,
        (SELECT COUNT(*) FROM whatsapp_message_logs wl WHERE wl.customer_id=c.id) AS whatsapp_log_count,
        CASE WHEN
          (SELECT COUNT(*) FROM subscriptions s WHERE s.customer_id=c.id)=0
          AND (SELECT COUNT(*) FROM invoices i WHERE i.customer_id=c.id)=0
          AND (SELECT COUNT(*) FROM customer_payment_confirmations pc WHERE pc.customer_id=c.id)=0
          AND (SELECT COUNT(*) FROM whatsapp_message_logs wl WHERE wl.customer_id=c.id)=0
        THEN 1 ELSE 0 END AS can_delete
      FROM customers c ORDER BY c.id DESC
    `).all(),
    portalCustomers: db.prepare(`
      SELECT c.id,c.customer_code,c.full_name,c.status,a.is_active AS portal_active,a.last_login_at
      FROM customers c LEFT JOIN customer_portal_accounts a ON a.customer_id=c.id
      ORDER BY c.id DESC
    `).all(),
    paymentConfirmations: db.prepare(`
      SELECT pc.*,c.customer_code,c.full_name,i.invoice_number,
        COALESCE(p.amount_idr,0) AS recorded_payment_idr,
        COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r
          WHERE r.payment_id=pc.payment_id),0) AS reversed_amount_idr,
        CASE
          WHEN pc.status='approved' AND pc.payment_id IS NOT NULL
            AND COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r
              WHERE r.payment_id=pc.payment_id),0) >= COALESCE(p.amount_idr,0)
            THEN 'reversed'
          WHEN pc.status='approved' AND pc.payment_id IS NOT NULL
            AND COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r
              WHERE r.payment_id=pc.payment_id),0) > 0
            THEN 'partially_reversed'
          ELSE pc.status
        END AS display_status
      FROM customer_payment_confirmations pc
      JOIN customers c ON c.id=pc.customer_id
      JOIN invoices i ON i.id=pc.invoice_id
      LEFT JOIN payments p ON p.id=pc.payment_id
      ORDER BY CASE pc.status WHEN 'pending' THEN 0 ELSE 1 END, pc.id DESC
      LIMIT 100
    `).all(),
    plans: db.prepare("SELECT * FROM internet_plans ORDER BY id DESC").all(),
    subscriptions: db.prepare("SELECT s.*,c.customer_code,c.full_name,p.name AS plan_name,p.monthly_price_idr FROM subscriptions s JOIN customers c ON c.id=s.customer_id JOIN internet_plans p ON p.id=s.plan_id ORDER BY s.id DESC").all(),
    invoices: db.prepare("SELECT i.*,c.full_name,c.customer_code,COALESCE((SELECT SUM(amount_idr) FROM payments WHERE invoice_id=i.id),0) - COALESCE((SELECT SUM(r.amount_idr) FROM payment_reversals r JOIN payments p ON p.id=r.payment_id WHERE p.invoice_id=i.id),0) AS paid_idr FROM invoices i JOIN customers c ON c.id=i.customer_id ORDER BY i.id DESC").all(),
    payments: db.prepare("SELECT p.*,i.invoice_number,COALESCE((SELECT SUM(amount_idr) FROM payment_reversals WHERE payment_id=p.id),0) AS reversed_idr FROM payments p JOIN invoices i ON i.id=p.invoice_id ORDER BY p.id DESC LIMIT 100").all(),
    reversals: db.prepare("SELECT r.*,p.payment_reference,i.invoice_number FROM payment_reversals r JOIN payments p ON p.id=r.payment_id JOIN invoices i ON i.id=p.invoice_id ORDER BY r.id DESC LIMIT 100").all(),
    dueReminders: billing.getDueReminders({ today: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()), daysAhead: 7 }),
    ...extra
  };
}
router.get("/", managers, (req,res) => res.render("billing/index", pageData({
  notice: req.query.notice || null,
  error: req.query.error || null,
  customerFormError: req.query.customerError || null,
  openCustomerForm: req.query.openCustomerForm === "1" || Boolean(req.query.customerError)
})));

router.post("/customers", managers, (req,res) => {
  try {
    const customer = billing.validateCustomer(req.body);
    const planIdRaw = String(req.body.plan_id || "").trim();
    const portalRequested = req.body.create_portal_account === "1";
    let subscription = null;
    let portalPasswordHash = null;

    if (planIdRaw) {
      const planId = Number(planIdRaw);
      const billingDay = Number(req.body.billing_day || 1);
      if (!Number.isSafeInteger(planId) || planId < 1 ||
          !Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) {
        throw new Error("Pilihan paket atau tanggal billing tidak valid.");
      }
      const plan = db.prepare("SELECT id,plan_code,name FROM internet_plans WHERE id=? AND is_active=1").get(planId);
      if (!plan) throw new Error("Paket internet tidak aktif atau tidak ditemukan.");
      subscription = {
        planId,
        planName: plan.name,
        startDate: billing.validateDate(req.body.start_date, "Tanggal mulai langganan"),
        billingDay,
        externalRef: billing.optionalText(req.body.external_device_ref, "Referensi perangkat", 150),
        notes: billing.optionalText(req.body.subscription_notes, "Catatan langganan")
      };
    }

    if (portalRequested) {
      if (req.session.user.role !== "admin") {
        throw new Error("Hanya admin yang dapat membuat akses portal pelanggan.");
      }
      const password = String(req.body.portal_password || "");
      if (password.length < 12 || password.length > 200) {
        throw new Error("Password portal harus 12–200 karakter.");
      }
      portalPasswordHash = bcrypt.hashSync(password, 12);
    }

    const whatsappOptIn = req.body.whatsapp_opt_in === "1" ? 1 : 0;
    const created = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO customers
          (customer_code,full_name,email,phone,address,identity_number,notes,
           whatsapp_opt_in,whatsapp_opt_in_at)
        VALUES (?,?,?,?,?,?,?, ?,CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END)
      `).run(
        customer.customer_code, customer.full_name, customer.email, customer.phone,
        customer.address, customer.identity_number, customer.notes,
        whatsappOptIn, whatsappOptIn
      );
      const customerId = Number(result.lastInsertRowid);

      recordAudit({
        user: req.session.user,
        action: "customer.create",
        entityType: "customer",
        entityId: customerId,
        summary: "Menambahkan pelanggan " + customer.customer_code
      });

      let subscriptionId = null;
      if (subscription) {
        const sub = db.prepare(`
          INSERT INTO subscriptions
            (customer_id,plan_id,start_date,billing_day,external_device_ref,notes)
          VALUES (?,?,?,?,?,?)
        `).run(
          customerId, subscription.planId, subscription.startDate,
          subscription.billingDay, subscription.externalRef, subscription.notes
        );
        subscriptionId = Number(sub.lastInsertRowid);
        recordAudit({
          user: req.session.user,
          action: "subscription.create",
          entityType: "subscription",
          entityId: subscriptionId,
          summary: "Membuat langganan " + subscription.planName + " untuk " + customer.customer_code
        });
      }

      let portalCreated = false;
      if (portalPasswordHash) {
        db.prepare(`
          INSERT INTO customer_portal_accounts (customer_id,password_hash,is_active)
          VALUES (?,?,1)
        `).run(customerId, portalPasswordHash);
        portalCreated = true;
        recordAudit({
          user: req.session.user,
          action: "customer.portal_account.create",
          entityType: "customer_portal_account",
          entityId: customerId,
          summary: "Membuat akses portal untuk pelanggan " + customer.customer_code
        });
      }

      return { customerId, subscriptionId, portalCreated };
    })();

    const completed = [
      "Pelanggan " + customer.customer_code + " berhasil ditambahkan",
      created.subscriptionId ? "langganan " + subscription.planName + " dibuat" : null,
      created.portalCreated ? "akses portal pelanggan dibuat" : null
    ].filter(Boolean).join("; ");
    res.redirect("/billing?notice=" + encodeURIComponent(completed + "."));
  } catch(e) {
    const message = e.code === "SQLITE_CONSTRAINT_UNIQUE"
      ? "Kode pelanggan sudah digunakan."
      : e.message;
    res.redirect("/billing?customerError=" + encodeURIComponent(message) + "&openCustomerForm=1");
  }
});
router.post("/customers/:id/update", managers, (req,res) => {
  const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<1) return res.status(400).send("ID tidak valid.");
  try { const v=billing.validateCustomer(req.body); const r=db.prepare("UPDATE customers SET customer_code=?,full_name=?,email=?,phone=?,address=?,identity_number=?,notes=?,whatsapp_opt_in=?,whatsapp_opt_in_at=CASE WHEN ?=1 THEN COALESCE(whatsapp_opt_in_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(v.customer_code,v.full_name,v.email,v.phone,v.address,v.identity_number,v.notes,req.body.whatsapp_opt_in === "1" ? 1 : 0,req.body.whatsapp_opt_in === "1" ? 1 : 0,id); if(!r.changes)return res.status(404).send("Pelanggan tidak ditemukan."); recordAudit({ user: req.session.user, action: "customer.update", entityType: "customer", entityId: id, summary: "Memperbarui data pelanggan " + v.customer_code }); res.redirect("/billing?notice=Data%20pelanggan%20diperbarui."); }
  catch(e){ if(e.code==="SQLITE_CONSTRAINT_UNIQUE")return fail(res,new Error("Kode pelanggan sudah digunakan.")); return fail(res,e); }
});
router.post("/customers/:id/status", managers, (req,res) => {
  const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID tidak valid.");
  const r=db.prepare("UPDATE customers SET status=CASE status WHEN 'active' THEN 'inactive' ELSE 'active' END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  if(!r.changes)return res.status(404).send("Pelanggan tidak ditemukan."); recordAudit({ user: req.session.user, action: "customer.status", entityType: "customer", entityId: id, summary: "Mengubah status pelanggan ID " + id }); res.redirect("/billing?notice=Status%20pelanggan%20diperbarui.");
});

router.post("/customers/:id/delete", admins, (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.redirect("/billing?error=" + encodeURIComponent("ID pelanggan tidak valid."));
  }

  try {
    const deleted = db.transaction(() => {
      const customer = db.prepare(
        "SELECT id,customer_code,full_name FROM customers WHERE id=?"
      ).get(id);
      if (!customer) throw new Error("Pelanggan tidak ditemukan.");

      const counts = {
        subscriptions: db.prepare("SELECT COUNT(*) AS total FROM subscriptions WHERE customer_id=?").get(id).total,
        invoices: db.prepare("SELECT COUNT(*) AS total FROM invoices WHERE customer_id=?").get(id).total,
        confirmations: db.prepare("SELECT COUNT(*) AS total FROM customer_payment_confirmations WHERE customer_id=?").get(id).total,
        whatsappLogs: db.prepare("SELECT COUNT(*) AS total FROM whatsapp_message_logs WHERE customer_id=?").get(id).total
      };
      const blockers = [];
      if (counts.subscriptions) blockers.push(counts.subscriptions + " langganan");
      if (counts.invoices) blockers.push(counts.invoices + " invoice");
      if (counts.confirmations) blockers.push(counts.confirmations + " konfirmasi pembayaran");
      if (counts.whatsappLogs) blockers.push(counts.whatsappLogs + " riwayat WhatsApp");

      if (blockers.length) {
        throw new Error(
          "Pelanggan tidak dapat dihapus karena memiliki " + blockers.join(", ") +
          ". Nonaktifkan pelanggan agar seluruh riwayat tetap tersimpan."
        );
      }

      // Remove only the dependent portal credential. The portal session will
      // be rejected on its next request because its account no longer exists.
      db.prepare("DELETE FROM customer_portal_accounts WHERE customer_id=?").run(id);
      db.prepare("DELETE FROM customers WHERE id=?").run(id);

      recordAudit({
        user: req.session.user,
        action: "customer.delete",
        entityType: "customer",
        entityId: id,
        summary: "Menghapus permanen pelanggan " + customer.customer_code + " (" + customer.full_name + ") tanpa riwayat transaksi"
      });
      return customer;
    })();

    return res.redirect("/billing?notice=" + encodeURIComponent(
      "Pelanggan " + deleted.customer_code + " berhasil dihapus."
    ));
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return res.redirect("/billing?error=" + encodeURIComponent(
        "Pelanggan masih terhubung dengan data lain dan tidak dapat dihapus. Gunakan Nonaktifkan."
      ));
    }
    return res.redirect("/billing?error=" + encodeURIComponent(error.message));
  }
});

router.post("/portal-accounts/:customerId", admins, (req,res) => {
  const customerId=Number(req.params.customerId);
  const password=String(req.body.password||"");
  if(!Number.isSafeInteger(customerId)||customerId<1)return res.status(400).send("ID pelanggan tidak valid.");
  if(password.length<12||password.length>200)return res.redirect("/billing?notice="+encodeURIComponent("Password portal harus 12–200 karakter."));
  const customer=db.prepare("SELECT id,customer_code,status FROM customers WHERE id=?").get(customerId);
  if(!customer||customer.status!=="active")return res.redirect("/billing?notice="+encodeURIComponent("Akun portal hanya dapat dibuat untuk pelanggan aktif."));
  const hash=bcrypt.hashSync(password,12);
  db.prepare(`
    INSERT INTO customer_portal_accounts (customer_id,password_hash,is_active)
    VALUES (?,?,1)
    ON CONFLICT(customer_id) DO UPDATE SET
      password_hash=excluded.password_hash,is_active=1,updated_at=CURRENT_TIMESTAMP
  `).run(customerId,hash);
  recordAudit({user:req.session.user,action:"customer.portal_account.upsert",entityType:"customer_portal_account",entityId:customerId,summary:"Membuat atau mengatur ulang akses portal untuk "+customer.customer_code});
  res.redirect("/billing?notice="+encodeURIComponent("Akses portal pelanggan berhasil disimpan. Berikan ID pelanggan dan password sementara secara aman."));
});

router.post("/portal-accounts/:customerId/status", admins, (req,res) => {
  const customerId=Number(req.params.customerId);
  if(!Number.isSafeInteger(customerId)||customerId<1)return res.status(400).send("ID pelanggan tidak valid.");
  const r=db.prepare("UPDATE customer_portal_accounts SET is_active=1-is_active,updated_at=CURRENT_TIMESTAMP WHERE customer_id=?").run(customerId);
  if(!r.changes)return res.status(404).send("Akun portal tidak ditemukan.");
  recordAudit({user:req.session.user,action:"customer.portal_account.status",entityType:"customer_portal_account",entityId:customerId,summary:"Mengubah status akses portal pelanggan ID "+customerId});
  res.redirect("/billing?notice="+encodeURIComponent("Status akses portal diperbarui."));
});

router.post("/payment-confirmations/:id/approve", managers, (req,res) => {
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID konfirmasi tidak valid.");
  try {
    let payment;
    db.transaction(() => {
      const confirmation=db.prepare("SELECT * FROM customer_payment_confirmations WHERE id=? AND status='pending'").get(id);
      if(!confirmation)throw new Error("Konfirmasi tidak ditemukan atau sudah ditinjau.");
      payment=billing.recordPayment({
        invoiceId:confirmation.invoice_id,
        input:{
          amount_idr:confirmation.amount_idr,
          payment_method:confirmation.payment_method,
          paid_at:confirmation.paid_at,
          notes:"Konfirmasi pelanggan: "+confirmation.payment_reference+(confirmation.notes?" · "+confirmation.notes:"")
        },
        userId:req.session.user.id
      });
      db.prepare(`
        UPDATE customer_payment_confirmations
        SET status='approved',payment_id=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_note=NULL
        WHERE id=? AND status='pending'
      `).run(payment.id,req.session.user.id,id);
    })();
    recordAudit({user:req.session.user,action:"customer.payment_confirmation.approve",entityType:"customer_payment_confirmation",entityId:id,summary:"Menyetujui konfirmasi pembayaran pelanggan dan mencatat "+payment.payment_reference});
    res.redirect("/billing?notice="+encodeURIComponent("Konfirmasi disetujui dan pembayaran berhasil dicatat."));
  } catch(error) {
    res.redirect("/billing?notice="+encodeURIComponent("Konfirmasi gagal disetujui: "+error.message));
  }
});

router.post("/payment-confirmations/:id/reject", managers, (req,res) => {
  const id=Number(req.params.id);
  const note=String(req.body.review_note||"").trim();
  if(!Number.isSafeInteger(id)||id<1)return res.status(400).send("ID konfirmasi tidak valid.");
  if(note.length<5||note.length>500)return res.redirect("/billing?notice="+encodeURIComponent("Alasan penolakan harus 5–500 karakter."));
  const result=db.prepare(`
    UPDATE customer_payment_confirmations
    SET status='rejected',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_note=?
    WHERE id=? AND status='pending'
  `).run(req.session.user.id,note,id);
  if(!result.changes)return res.redirect("/billing?notice="+encodeURIComponent("Konfirmasi tidak ditemukan atau sudah ditinjau."));
  recordAudit({user:req.session.user,action:"customer.payment_confirmation.reject",entityType:"customer_payment_confirmation",entityId:id,summary:"Menolak konfirmasi pembayaran: "+note});
  res.redirect("/billing?notice="+encodeURIComponent("Konfirmasi pembayaran ditolak."));
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
