const router = require("express").Router();
const { db } = require("../../../database/db");
const { recordAudit } = require("../../../modules/audit");
const billing = require("../../../modules/billing");
const { requireRole } = require("../middleware/auth");

const managers = requireRole("admin", "finance");
const admins = requireRole("admin");

function redirectWith(path, key, message) {
  return path + "?" + key + "=" + encodeURIComponent(message);
}

function positiveInteger(value, field, { optional = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(value ?? "").trim();
  if (optional && !raw) return null;
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw new Error(field + " harus berupa bilangan bulat yang valid.");
  }
  return number;
}

function validateVoucher(input) {
  const package_code = String(input.package_code ?? "").trim().toUpperCase();
  const name = String(input.name ?? "").trim();
  const validity_value = positiveInteger(input.validity_value, "Masa berlaku", { max: 8760 });
  const validity_unit = String(input.validity_unit ?? "");
  const quota_mb = positiveInteger(input.quota_mb, "Kuota", { optional: true, max: 1048576 });
  const speed_mbps = positiveInteger(input.speed_mbps, "Kecepatan", { optional: true, max: 100000 });
  const price_idr = Number(String(input.price_idr ?? "").trim());
  const description = String(input.description ?? "").trim();

  if (package_code.length < 2 || package_code.length > 30) {
    throw new Error("Kode paket harus 2–30 karakter.");
  }
  if (name.length < 2 || name.length > 100) {
    throw new Error("Nama paket harus 2–100 karakter.");
  }
  if (!["hours", "days"].includes(validity_unit)) {
    throw new Error("Satuan masa berlaku tidak valid.");
  }
  if (validity_unit === "days" && validity_value > 365) {
    throw new Error("Masa berlaku paket maksimal 365 hari.");
  }
  if (!Number.isSafeInteger(price_idr) || price_idr < 0) {
    throw new Error("Harga voucher harus bilangan bulat nol atau lebih.");
  }
  if (description.length > 500) {
    throw new Error("Deskripsi maksimal 500 karakter.");
  }

  return {
    package_code,
    name,
    validity_value,
    validity_unit,
    quota_mb,
    speed_mbps,
    price_idr,
    description: description || null
  };
}

router.get("/monthly", managers, (req, res) => {
  const plans = db.prepare("SELECT * FROM internet_plans ORDER BY is_active DESC, name COLLATE NOCASE").all();
  res.render("plans/monthly", {
    title: "Paket Internet Bulanan",
    plans,
    notice: req.query.notice || null,
    error: req.query.error || null
  });
});

router.post("/monthly", admins, (req, res) => {
  try {
    const v = billing.validatePlan(req.body);
    const result = db.prepare(`
      INSERT INTO internet_plans (plan_code,name,speed_mbps,monthly_price_idr,description)
      VALUES (?,?,?,?,?)
    `).run(v.plan_code, v.name, v.speed_mbps, v.monthly_price_idr, v.description);
    recordAudit({
      user: req.session.user,
      action: "plan.create",
      entityType: "internet_plan",
      entityId: result.lastInsertRowid,
      summary: "Menambahkan paket bulanan " + v.plan_code
    });
    res.redirect(redirectWith("/plans/monthly", "notice", "Paket bulanan berhasil ditambahkan."));
  } catch (error) {
    const message = error.code === "SQLITE_CONSTRAINT_UNIQUE"
      ? "Kode paket bulanan sudah digunakan."
      : error.message;
    res.redirect(redirectWith("/plans/monthly", "error", message));
  }
});

router.post("/monthly/:id/update", admins, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).send("ID paket tidak valid.");
  try {
    const v = billing.validatePlan(req.body);
    const result = db.prepare(`
      UPDATE internet_plans
      SET plan_code=?,name=?,speed_mbps=?,monthly_price_idr=?,description=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(v.plan_code, v.name, v.speed_mbps, v.monthly_price_idr, v.description, id);
    if (!result.changes) return res.status(404).send("Paket bulanan tidak ditemukan.");
    recordAudit({
      user: req.session.user,
      action: "plan.update",
      entityType: "internet_plan",
      entityId: id,
      summary: "Memperbarui paket bulanan " + v.plan_code
    });
    res.redirect(redirectWith("/plans/monthly", "notice", "Paket bulanan berhasil diperbarui."));
  } catch (error) {
    const message = error.code === "SQLITE_CONSTRAINT_UNIQUE"
      ? "Kode paket bulanan sudah digunakan."
      : error.message;
    res.redirect(redirectWith("/plans/monthly", "error", message));
  }
});

router.post("/monthly/:id/status", admins, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).send("ID paket tidak valid.");
  const result = db.prepare("UPDATE internet_plans SET is_active=1-is_active,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  if (!result.changes) return res.status(404).send("Paket bulanan tidak ditemukan.");
  recordAudit({
    user: req.session.user,
    action: "plan.status",
    entityType: "internet_plan",
    entityId: id,
    summary: "Mengubah status paket bulanan ID " + id
  });
  res.redirect(redirectWith("/plans/monthly", "notice", "Status paket bulanan diperbarui."));
});

router.get("/voucher", managers, (req, res) => {
  const vouchers = db.prepare("SELECT * FROM voucher_packages ORDER BY is_active DESC, name COLLATE NOCASE").all();
  res.render("plans/voucher", {
    title: "Paket Voucher",
    vouchers,
    notice: req.query.notice || null,
    error: req.query.error || null
  });
});

router.post("/voucher", admins, (req, res) => {
  try {
    const v = validateVoucher(req.body);
    const result = db.prepare(`
      INSERT INTO voucher_packages
        (package_code,name,validity_value,validity_unit,quota_mb,speed_mbps,price_idr,description)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      v.package_code, v.name, v.validity_value, v.validity_unit,
      v.quota_mb, v.speed_mbps, v.price_idr, v.description
    );
    recordAudit({
      user: req.session.user,
      action: "voucher_plan.create",
      entityType: "voucher_package",
      entityId: result.lastInsertRowid,
      summary: "Menambahkan paket voucher " + v.package_code
    });
    res.redirect(redirectWith("/plans/voucher", "notice", "Paket voucher berhasil ditambahkan."));
  } catch (error) {
    const message = error.code === "SQLITE_CONSTRAINT_UNIQUE"
      ? "Kode paket voucher sudah digunakan."
      : error.message;
    res.redirect(redirectWith("/plans/voucher", "error", message));
  }
});

router.post("/voucher/:id/update", admins, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).send("ID paket tidak valid.");
  try {
    const v = validateVoucher(req.body);
    const result = db.prepare(`
      UPDATE voucher_packages
      SET package_code=?,name=?,validity_value=?,validity_unit=?,quota_mb=?,speed_mbps=?,
          price_idr=?,description=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      v.package_code, v.name, v.validity_value, v.validity_unit,
      v.quota_mb, v.speed_mbps, v.price_idr, v.description, id
    );
    if (!result.changes) return res.status(404).send("Paket voucher tidak ditemukan.");
    recordAudit({
      user: req.session.user,
      action: "voucher_plan.update",
      entityType: "voucher_package",
      entityId: id,
      summary: "Memperbarui paket voucher " + v.package_code
    });
    res.redirect(redirectWith("/plans/voucher", "notice", "Paket voucher berhasil diperbarui."));
  } catch (error) {
    const message = error.code === "SQLITE_CONSTRAINT_UNIQUE"
      ? "Kode paket voucher sudah digunakan."
      : error.message;
    res.redirect(redirectWith("/plans/voucher", "error", message));
  }
});

router.post("/voucher/:id/status", admins, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).send("ID paket tidak valid.");
  const result = db.prepare("UPDATE voucher_packages SET is_active=1-is_active,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  if (!result.changes) return res.status(404).send("Paket voucher tidak ditemukan.");
  recordAudit({
    user: req.session.user,
    action: "voucher_plan.status",
    entityType: "voucher_package",
    entityId: id,
    summary: "Mengubah status paket voucher ID " + id
  });
  res.redirect(redirectWith("/plans/voucher", "notice", "Status paket voucher diperbarui."));
});

module.exports = router;
