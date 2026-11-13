const { db } = require("../../../database/db");

function loadActiveUser(req) {
  const sessionUser = req.session && req.session.user;
  const id = Number(sessionUser && sessionUser.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  const user = db.prepare(
    "SELECT id,name,email,role,is_active FROM users WHERE id=?"
  ).get(id);
  if (!user || user.is_active !== 1) return null;

  // Roles and identity are read from the database so a deleted, disabled,
  // or demoted account cannot continue using a stale session.
  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
  return user;
}

function rejectStaleSession(req, res) {
  if (!req.session) return res.redirect("/login");
  return req.session.destroy(() => {
    res.clearCookie("ffbilling.sid");
    res.redirect("/login");
  });
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  if (!loadActiveUser(req)) return rejectStaleSession(req, res);
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    const user = loadActiveUser(req);
    if (!user) return rejectStaleSession(req, res);
    if (!roles.includes(user.role)) {
      return res.status(403).send("Kamu tidak memiliki izin untuk membuka halaman ini.");
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, loadActiveUser };
