const router = require("express").Router();
const { requireAuth } = require("../middleware/auth");

router.get("/", requireAuth, (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
    stats: [
      { label: "Total Pelanggan", value: "0" },
      { label: "Pelanggan Online", value: "0" },
      { label: "Tagihan Belum Dibayar", value: "0" },
      { label: "Perangkat ONT", value: "0" }
    ]
  });
});

module.exports = router;
