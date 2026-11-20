const router = require("express").Router();
const { db } = require("../../../database/db");
const billing = require("../../../modules/billing");
const { requireAuth } = require("../middleware/auth");

router.get("/", requireAuth, (req, res) => {
  const customerCount = db.prepare("SELECT COUNT(*) AS total FROM customers WHERE tenant_id=?").get(req.tenant.id).total;
  const activeSubscriptions = db.prepare("SELECT COUNT(*) AS total FROM subscriptions WHERE tenant_id=? AND status='active'").get(req.tenant.id).total;
  const outstanding = billing.getOutstandingBalance(req.tenant.id);
  const deviceRefs = db.prepare("SELECT COUNT(*) AS total FROM subscriptions WHERE tenant_id=? AND external_device_ref IS NOT NULL AND external_device_ref <> ''").get(req.tenant.id).total;
  res.render("dashboard", {
    title: "Dashboard",
    stats: [
      { label: "Total Pelanggan", value: customerCount.toLocaleString("id-ID"), description: "Seluruh pelanggan yang terdaftar" },
      { label: "Langganan Aktif", value: activeSubscriptions.toLocaleString("id-ID"), description: "Layanan yang sedang berjalan" },
      { label: "Sisa Tagihan", value: new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(outstanding), description: "Akumulasi invoice yang belum lunas" },
      { label: "Referensi Perangkat", value: deviceRefs.toLocaleString("id-ID"), description: "Langganan dengan ID perangkat" }
    ]
  });
});

module.exports = router;
