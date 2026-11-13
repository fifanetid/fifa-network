const router = require("express").Router();
const { db } = require("../../../database/db");
const { requireRole } = require("../middleware/auth");

router.use(requireRole("admin"));
router.get("/", (req, res) => {
  const logs = db.prepare(`
    SELECT id, actor_name, actor_role, action, entity_type, entity_id, summary, created_at
    FROM audit_logs ORDER BY id DESC LIMIT 200
  `).all();
  res.render("audit", { title: "Audit Log", logs });
});

module.exports = router;
