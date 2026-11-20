const { db } = require("../../../database/db");
const { getMembership } = require("../../../modules/tenancy");

function loadActiveUser(req) {
  const sessionUser = req.session && req.session.user;
  const id = Number(sessionUser && sessionUser.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  const user = db.prepare(
    "SELECT id,name,email,role,is_active FROM users WHERE id=?"
  ).get(id);
  if (!user || user.is_active !== 1) return null;

  // Tenant identity and role are resolved from the authenticated membership,
  // never from a request parameter or a stale session role.
  const membership = getMembership(id, req.session.tenantId);
  if (!membership) return null;
  req.tenant = {
    id: membership.tenant_id,
    name: membership.name,
    slug: membership.slug,
    planCode: membership.plan_code,
    timezone: membership.timezone
  };
  req.tenantRole = membership.role;
  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: membership.role
  };
  return { ...user, role: membership.role };
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
    if (!roles.includes(req.tenantRole)) {
      return res.status(403).send("Kamu tidak memiliki izin untuk membuka halaman ini.");
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, loadActiveUser };
