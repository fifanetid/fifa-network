const router = require("express").Router();
const { requireRole } = require("../middleware/auth");
const reports = require("../../../modules/reports");

router.use(requireRole("admin", "finance"));

router.get("/", (req, res) => {
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const firstDay = today.slice(0, 8) + "01";
  try {
    const from = req.query.from || firstDay;
    const to = req.query.to || today;
    const report = reports.getFinancialReport({ from, to });
    res.render("reports", {
      title: "Laporan Keuangan",
      report,
      error: null,
      formatIdr: value => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value)
    });
  } catch (error) {
    res.status(400).render("reports", {
      title: "Laporan Keuangan",
      report: null,
      error: error.message,
      from: req.query.from || firstDay,
      to: req.query.to || today,
      formatIdr: value => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value)
    });
  }
});

module.exports = router;
