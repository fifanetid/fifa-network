const router = require("express").Router();
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { db } = require("../../../database/db");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit."
});

router.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  const userCount = db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
  res.render("login", {
    title: "Login",
    setupRequired: userCount === 0,
    error: req.query.error ? "Username/email atau password salah, atau akun tidak aktif." : null
  });
});

router.post("/login", loginLimiter, (req, res, next) => {
  const identifier = String(req.body.identifier ?? req.body.email ?? "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!identifier || !password || identifier.length > 254 || password.length > 200) {
    return res.redirect("/login?error=1");
  }

  const user = db.prepare(`
    SELECT * FROM users
    WHERE (email = ? OR lower(name) = ?) AND is_active = 1
    ORDER BY CASE WHEN email = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(identifier, identifier, identifier);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.redirect("/login?error=1");
  }

  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };
    db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
    req.session.save((saveError) => {
      if (saveError) return next(saveError);
      res.redirect("/");
    });
  });
});

router.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("ffbilling.sid");
    res.redirect("/login");
  });
});

router.use("/customer", require("./customer-portal"));

module.exports = router;
