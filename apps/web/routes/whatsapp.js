"use strict";

const router = require("express").Router();
const { db } = require("../../../database/db");
const { recordAudit } = require("../../../modules/audit");
const whatsapp = require("../../../modules/whatsapp/client");
const { processReminders } = require("../../../modules/whatsapp/reminders");
const { requireRole } = require("../middleware/auth");
const admins = requireRole("admin");

router.use(admins);

router.get("/", (req, res) => {
  const logs = db.prepare(`
    SELECT l.*, c.customer_code, c.full_name, i.invoice_number
    FROM whatsapp_message_logs l
    LEFT JOIN customers c ON c.id=l.customer_id
    LEFT JOIN invoices i ON i.id=l.invoice_id
    ORDER BY l.id DESC LIMIT 50
  `).all();
  res.render("whatsapp/index", {
    title: "WhatsApp Gateway",
    status: whatsapp.snapshot(),
    logs,
    notice: req.query.notice || null,
    error: null
  });
});

router.get("/status", (req, res) => res.json(whatsapp.snapshot()));

router.post("/connect", async (req, res, next) => {
  try {
    await whatsapp.connect();
    recordAudit({ user: req.session.user, action: "whatsapp.connect", entityType: "whatsapp_gateway", summary: "Memulai koneksi WhatsApp Gateway" });
    res.redirect("/admin/whatsapp?notice=" + encodeURIComponent("Permintaan koneksi dimulai. Pindai QR jika ditampilkan."));
  } catch (error) { next(error); }
});

router.post("/disconnect", async (req, res, next) => {
  try {
    await whatsapp.disconnect();
    recordAudit({ user: req.session.user, action: "whatsapp.disconnect", entityType: "whatsapp_gateway", summary: "Memutus koneksi WhatsApp Gateway" });
    res.redirect("/admin/whatsapp?notice=" + encodeURIComponent("WhatsApp berhasil diputus."));
  } catch (error) { next(error); }
});

router.post("/test", async (req, res) => {
  const phone = String(req.body.phone || "");
  try {
    const message = String(req.body.message || "Tes koneksi FF BILLING. Jika pesan ini diterima, WhatsApp Gateway berhasil terhubung.");
    await whatsapp.sendText(phone, message);
    db.prepare("INSERT INTO whatsapp_message_logs (phone,message_type,status) VALUES (?,'test','sent')").run(whatsapp.normalizePhone(phone));
    recordAudit({ user: req.session.user, action: "whatsapp.test", entityType: "whatsapp_gateway", summary: "Mengirim pesan uji WhatsApp ke " + whatsapp.normalizePhone(phone) });
    res.redirect("/admin/whatsapp?notice=" + encodeURIComponent("Pesan uji berhasil dikirim."));
  } catch (error) {
    try {
      db.prepare("INSERT INTO whatsapp_message_logs (phone,message_type,status,error_message) VALUES (?,'test','failed',?)")
        .run(phone.replace(/[^0-9]/g, "").slice(0, 20) || "unknown", String(error.message).slice(0, 500));
    } catch {}
    res.redirect("/admin/whatsapp?notice=" + encodeURIComponent("Pesan uji gagal: " + error.message));
  }
});

router.post("/reminders/run", async (req, res) => {
  try {
    const result = await processReminders({ limit: 20, delayMs: 5000 });
    recordAudit({ user: req.session.user, action: "whatsapp.reminders.run", entityType: "whatsapp_gateway", summary: "Menjalankan pengingat: " + result.sent + " terkirim, " + result.failed + " gagal" });
    res.redirect("/admin/whatsapp?notice=" + encodeURIComponent("Pengingat selesai. Terkirim: " + result.sent + ", gagal: " + result.failed + ", dilewati: " + result.skipped + "."));
  } catch (error) {
    res.redirect("/admin/whatsapp?notice=" + encodeURIComponent("Pengingat gagal: " + error.message));
  }
});

module.exports = router;
