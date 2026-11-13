const router = require("express").Router();
const { db } = require("../../../database/db");
const billing = require("../../../modules/billing");
const { requireAuth } = require("../middleware/auth");

router.get("/", requireAuth, (req, res) => {
  const customerCount = db.prepare("SELECT COUNT(*) AS total FROM customers").get().total;
  const activeSubscriptions = db.prepare("SELECT COUNT(*) AS total FROM subscriptions WHERE status='active'").get().total;
  const outstanding = billing.getOutstandingBalance();
  const deviceRefs = db.prepare("SELECT COUNT(*) AS total FROM subscriptions WHERE external_device_ref IS NOT NULL AND external_device_ref <> ''").get().total;
  res.render("dashboard", {
    title: "Dashboard",
    stats: [
      { label: "Total Pelanggan", value: customerCount.toLocaleString("id-ID") },
      { label: "Langganan Aktif", value: activeSubscriptions.toLocaleString("id-ID") },
      { label: "Sisa Tagihan", value: new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(outstanding) },
      { label: "Referensi Perangkat", value: deviceRefs.toLocaleString("id-ID") }
    ]
  });
});

module.exports = router;
