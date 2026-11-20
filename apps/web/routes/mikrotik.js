"use strict";

const net = require("node:net");
const router = require("express").Router();
const { db } = require("../../../database/db");
const { recordAudit } = require("../../../modules/audit");
const { encryptSecret, loadEncryptionKey } = require("../../../modules/security/secrets");
const mikrotik = require("../../../modules/mikrotik/client");
const { requireRole } = require("../middleware/auth");

router.use(requireRole("admin"));

function isPrivateIpv4(value) {
  if (net.isIP(value) !== 4) return false;
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a,b] = parts;
  if (a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31) return true;
  return process.env.NODE_ENV !== "production" && a === 127;
}

function pageData(req, extra = {}) {
  const tenantId = req.tenant.id;
  let encryptionReady = true;
  try { loadEncryptionKey(); } catch { encryptionReady = false; }
  return {
    title: "MikroTik",
    encryptionReady,
    routers: db.prepare(`
      SELECT id,router_name,host,api_port,api_tls,api_username,
        connection_status,router_identity,router_version,router_uptime,
        cpu_load,cpu_count,memory_free_bytes,memory_total_bytes,
        active_ppp_count,active_ppp_json,last_checked_at,last_error,created_at,updated_at
      FROM mikrotik_routers
      WHERE tenant_id=?
      ORDER BY router_name COLLATE NOCASE,id
    `).all(tenantId).map(item => ({
      ...item,
      activePpp: (() => {
        try {
          const parsed = JSON.parse(item.active_ppp_json || "[]");
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })()
    })),
    ...extra
  };
}

function parseRouterInput(body, existing = null) {
  const name = String(body.router_name || "").trim();
  const host = String(body.host || "").trim();
  const username = String(body.api_username || "").trim();
  const password = String(body.api_password || "");
  const caCertificate = String(body.api_tls_ca || "").trim();
  const tls = ["1","on","true"].includes(String(body.api_tls || "").toLowerCase());

  if (name.length < 2 || name.length > 80) throw new Error("Nama router harus 2–80 karakter.");
  if (!isPrivateIpv4(host)) {
    throw new Error("Host harus berupa IP IPv4 privat (10.x, 172.16–31.x, atau 192.168.x). Gunakan VPN untuk router jarak jauh; IP publik dan hostname tidak diterima.");
  }
  if (!username || username.length > 64 || /[\u0000-\u001f\u007f]/.test(username)) {
    throw new Error("Username API harus 1–64 karakter dan tidak boleh berisi karakter kontrol.");
  }
  if (password.length > 200 || (!existing && password.length < 8) || (password && password.length < 8)) {
    throw new Error("Password API minimal 8 karakter dan maksimal 200 karakter.");
  }
  if (!password && !existing) throw new Error("Password API wajib diisi.");
  if (caCertificate.length > 15000 ||
      caCertificate && (!caCertificate.includes("-----BEGIN CERTIFICATE-----") ||
        !caCertificate.includes("-----END CERTIFICATE-----"))) {
    throw new Error("Sertifikat CA harus berupa PEM yang valid dan maksimal 15.000 karakter.");
  }
  if (!tls && caCertificate) throw new Error("Sertifikat CA hanya digunakan saat API-SSL diaktifkan.");

  return {
    router_name: name,
    host,
    api_port: tls ? 8729 : 8728,
    api_tls: tls ? 1 : 0,
    api_tls_ca_encrypted: !tls ? null
      : caCertificate ? encryptSecret(caCertificate)
        : existing?.api_tls_ca_encrypted || null,
    api_username: username,
    api_password_encrypted: password ? encryptSecret(password) : existing.api_password_encrypted
  };
}

router.get("/", (req, res) => {
  res.render("mikrotik/index", pageData(req, {
    notice: req.query.notice || null,
    error: req.query.error || null
  }));
});

router.post("/routers", (req, res) => {
  try {
    const input = parseRouterInput(req.body);
    const result = db.prepare(`
      INSERT INTO mikrotik_routers
        (tenant_id,router_name,host,api_port,api_tls,api_tls_ca_encrypted,api_username,api_password_encrypted,created_by,updated_by)
      VALUES (@tenantId,@router_name,@host,@api_port,@api_tls,@api_tls_ca_encrypted,@api_username,@api_password_encrypted,@userId,@userId)
    `).run({ ...input, tenantId:req.tenant.id, userId: req.session.user.id });
    recordAudit({
      user: req.session.user,
      action: "mikrotik.router.create",
      entityType: "mikrotik_router",
      entityId: result.lastInsertRowid,
      summary: "Menambahkan koneksi router MikroTik " + input.router_name + " (" + input.host + ")",
      tenantId:req.tenant.id
    });
    return res.redirect("/admin/mikrotik?notice=" + encodeURIComponent("Router berhasil disimpan. Uji koneksi untuk memeriksa akses API."));
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.redirect("/admin/mikrotik?error=" + encodeURIComponent("IP dan port router tersebut sudah terdaftar."));
    }
    return res.redirect("/admin/mikrotik?error=" + encodeURIComponent(error.message));
  }
});

router.post("/routers/:id/update", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(404).send("Router tidak ditemukan.");
  const existing = db.prepare("SELECT * FROM mikrotik_routers WHERE id=? AND tenant_id=?").get(id,req.tenant.id);
  if (!existing) return res.status(404).send("Router tidak ditemukan.");

  try {
    const input = parseRouterInput(req.body, existing);
    db.prepare(`
      UPDATE mikrotik_routers
      SET router_name=@router_name,host=@host,api_port=@api_port,api_tls=@api_tls,
          api_tls_ca_encrypted=@api_tls_ca_encrypted,
          api_username=@api_username,api_password_encrypted=@api_password_encrypted,
          connection_status='not_tested',router_identity=NULL,router_version=NULL,
          router_uptime=NULL,cpu_load=NULL,cpu_count=NULL,memory_free_bytes=NULL,
          memory_total_bytes=NULL,active_ppp_count=0,active_ppp_json='[]',
          last_checked_at=NULL,last_error=NULL,
          updated_by=@userId,updated_at=CURRENT_TIMESTAMP
      WHERE id=@id AND tenant_id=@tenantId
    `).run({ ...input, tenantId:req.tenant.id, userId: req.session.user.id, id });
    recordAudit({
      user: req.session.user,
      action: "mikrotik.router.update",
      entityType: "mikrotik_router",
      entityId: id,
      summary: "Memperbarui pengaturan koneksi router MikroTik " + input.router_name,
      tenantId:req.tenant.id
    });
    return res.redirect("/admin/mikrotik?notice=" + encodeURIComponent("Pengaturan router diperbarui. Uji koneksi kembali."));
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.redirect("/admin/mikrotik?error=" + encodeURIComponent("IP dan port router tersebut sudah digunakan router lain."));
    }
    return res.redirect("/admin/mikrotik?error=" + encodeURIComponent(error.message));
  }
});

router.post("/routers/:id/test", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(404).send("Router tidak ditemukan.");
  const target = db.prepare("SELECT * FROM mikrotik_routers WHERE id=? AND tenant_id=?").get(id,req.tenant.id);
  if (!target) return res.status(404).send("Router tidak ditemukan.");

  try {
    const result = await mikrotik.inspectRouter(target);
    db.prepare(`
      UPDATE mikrotik_routers SET
        connection_status='connected',router_identity=?,router_version=?,router_uptime=?,
        cpu_load=?,cpu_count=?,memory_free_bytes=?,memory_total_bytes=?,
        active_ppp_count=?,active_ppp_json=?,last_checked_at=CURRENT_TIMESTAMP,
        last_error=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=?
    `).run(
      result.identity, result.version, result.uptime, result.cpuLoad, result.cpuCount,
      result.memoryFreeBytes, result.memoryTotalBytes, result.activePppCount,
      JSON.stringify(result.activePpp), id, req.tenant.id
    );
    recordAudit({
      user: req.session.user,
      action: "mikrotik.router.test",
      entityType: "mikrotik_router",
      entityId: id,
      summary: "Uji koneksi baca-saja berhasil untuk " + target.router_name +
        ": " + result.activePppCount + " PPP aktif",
      tenantId:req.tenant.id
    });
    return res.redirect("/admin/mikrotik?notice=" + encodeURIComponent(
      "Koneksi ke " + target.router_name + " berhasil. Ditemukan " + result.activePppCount + " sesi PPP aktif."
    ));
  } catch (error) {
    const message = String(error.message || "Koneksi gagal").replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 500);
    db.prepare(`
      UPDATE mikrotik_routers SET connection_status='failed',
        last_checked_at=CURRENT_TIMESTAMP,last_error=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=?
    `).run(message, id, req.tenant.id);
    recordAudit({
      user: req.session.user,
      action: "mikrotik.router.test_failed",
      entityType: "mikrotik_router",
      entityId: id,
      summary: "Uji koneksi router " + target.router_name + " gagal: " + message.slice(0, 300),
      tenantId:req.tenant.id
    });
    return res.redirect("/admin/mikrotik?error=" + encodeURIComponent(
      "Koneksi ke " + target.router_name + " gagal: " + message
    ));
  }
});

router.post("/routers/:id/delete", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(404).send("Router tidak ditemukan.");
  const target = db.prepare("SELECT id,router_name,host FROM mikrotik_routers WHERE id=? AND tenant_id=?").get(id,req.tenant.id);
  if (!target) return res.status(404).send("Router tidak ditemukan.");
  db.transaction(() => {
    db.prepare("DELETE FROM mikrotik_routers WHERE id=? AND tenant_id=?").run(id,req.tenant.id);
    recordAudit({
      user: req.session.user,
      action: "mikrotik.router.delete",
      entityType: "mikrotik_router",
      entityId: id,
      summary: "Menghapus data koneksi router " + target.router_name + " (" + target.host + ") dari FF BILLING; tidak mengubah router",
      tenantId:req.tenant.id
    });
  })();
  res.redirect("/admin/mikrotik?notice=" + encodeURIComponent("Data koneksi router berhasil dihapus. Konfigurasi MikroTik tidak diubah."));
});

module.exports = { router, isPrivateIpv4, parseRouterInput };
