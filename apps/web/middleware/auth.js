function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).send("Kamu tidak memiliki izin untuk membuka halaman ini.");
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
